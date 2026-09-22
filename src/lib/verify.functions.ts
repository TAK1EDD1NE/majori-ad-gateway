import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export type VerifyResult =
  | { status: "ok"; invite_link: string }
  | { status: "not_found" }
  | { status: "already_joined" }
  | { status: "rate_limited" }
  | { status: "error"; message: string };

export type VerifyInput = {
  fullName: string;
  level: string;
  rotation: string;
  photoBase64: string;
  photoType: string;
};

const MAX_BYTES = 5 * 1024 * 1024;
const VALID_LEVELS = ["5", "4", "3"];
const VALID_ROTATIONS = ["rot1", "rot2", "rot3"];
const VALID_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z\s'-]/g, " ")
    .replace(/[-']/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export const verifyStudent = createServerFn({ method: "POST" })
  .inputValidator((data: VerifyInput) => {
    if (!data || typeof data.fullName !== "string" || typeof data.photoBase64 !== "string") {
      throw new Error("Requête invalide.");
    }
    if (data.fullName.trim().length < 3 || data.fullName.length > 120) {
      throw new Error("Nom invalide.");
    }
    if (!VALID_LEVELS.includes(data.level) || !VALID_ROTATIONS.includes(data.rotation)) {
      throw new Error("Niveau ou rotation invalide.");
    }
    if (!VALID_PHOTO_TYPES.includes(data.photoType)) {
      throw new Error("Format d'image non supporté.");
    }
    return data;
  })
  .handler(async ({ data }): Promise<VerifyResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const request = getRequest();
    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";

    // Rate limit: 5 attempts per IP per hour
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("verification_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", since);

    if ((count ?? 0) >= 5) return { status: "rate_limited" };
    await supabaseAdmin.from("verification_attempts").insert({ ip });

    const bytes = Buffer.from(data.photoBase64, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      return { status: "error", message: "Photo invalide (5 Mo maximum)." };
    }

    const target = normalize(data.fullName);
    const { data: students, error } = await supabaseAdmin
      .from("students")
      .select("id, nom, prenom, joined, level, rotation")
      .eq("level", data.level)
      .eq("rotation", data.rotation);

    if (error) return { status: "error", message: "Erreur serveur. Réessayez plus tard." };

    const match = (students ?? []).find((s) => {
      const a = normalize(`${s.nom} ${s.prenom}`);
      const b = normalize(`${s.prenom} ${s.nom}`);
      return a === target || b === target;
    });

    if (!match) return { status: "not_found" };
    if (match.joined) return { status: "already_joined" };

    // Chat ID comes from the groups table for this level/rotation
    const { data: group, error: groupError } = await supabaseAdmin
      .from("groups")
      .select("id, chat_id, label")
      .eq("level", data.level)
      .eq("rotation", data.rotation)
      .maybeSingle();

    if (groupError || !group) {
      console.error("No group configured for", data.level, data.rotation, groupError);
      return { status: "error", message: "Groupe non configuré. Contactez l'administration." };
    }

    const botToken = process.env["TELEGRAM_BOT_TOKEN"];
    if (!botToken) {
      return { status: "error", message: "Service indisponible. Contactez l'administration." };
    }

    const ext = data.photoType === "image/png" ? "png" : data.photoType === "image/webp" ? "webp" : "jpg";
    const path = `student-cards/${match.id}/${Date.now()}.${ext}`;

    // Invite-first: a failed photo upload must never block the student's
    // invite link. If the card can't be stored (full bucket, network, …) the
    // verification continues and the student is flagged photo_missing so the
    // admin knows the card is absent and why.
    let photoMissing = false;
    let photoError: string | null = null;
    try {
      const { uploadStudentCard } = await import("@/lib/cloudinary");
      const upload = await uploadStudentCard(bytes, path, data.photoType);
      if (!upload.ok) {
        photoMissing = true;
        photoError = upload.error;
        console.error("[verify] card upload failed, continuing:", upload.error);
      } else {
        console.log("[verify] card stored:", upload.publicId);
      }
    } catch (err) {
      photoMissing = true;
      photoError = String(err);
      console.error("[verify] card upload threw, continuing:", err);
    }

    const tgResponse = await fetch(`https://api.telegram.org/bot${botToken}/createChatInviteLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: group.chat_id,
        member_limit: 1,
        name: `${match.nom} ${match.prenom}`.slice(0, 32),
      }),
    });

    const tgBody = (await tgResponse.json()) as {
      ok?: boolean;
      result?: { invite_link?: string };
      description?: string;
    };

    if (!tgResponse.ok || !tgBody.ok || !tgBody.result?.invite_link) {
      console.error("Telegram createChatInviteLink failed", tgResponse.status, tgBody.description);
      return { status: "error", message: "Impossible de générer le lien. Contactez l'administration." };
    }

    const { error: updateError } = await supabaseAdmin
      .from("students")
      .update({ joined: true, photo_missing: photoMissing, photo_error: photoError })
      .eq("id", match.id)
      .eq("joined", false);

    if (updateError) {
      return { status: "error", message: "Erreur serveur. Contactez l'administration." };
    }

    return { status: "ok", invite_link: tgBody.result.invite_link };
  });
