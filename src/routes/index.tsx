import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

import { cn } from "@/lib/utils";
import { listGroups } from "@/lib/groups.functions";
import { verifyStudent, type VerifyResult } from "@/lib/verify.functions";
import Intro from "@/components/Intro";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vérification étudiante — Groupe Telegram de la promo" },
      {
        name: "description",
        content:
          "Vérifiez votre identité avec votre carte d'étudiant et recevez votre lien d'invitation unique vers le groupe Telegram de votre promotion.",
      },
      { property: "og:title", content: "Vérification étudiante — Groupe Telegram de la promo" },
      {
        property: "og:description",
        content:
          "Vérifiez votre identité avec votre carte d'étudiant et recevez votre lien d'invitation unique vers le groupe Telegram de votre promotion.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async () => ({
    groups: await listGroups(),
  }),
  component: Index,
});

const MAX_BYTES = 5 * 1024 * 1024;

function PillSwitcher<T extends string>({
  step,
  options,
  value,
  onChange,
}: {
  step: string;
  options: { value: T; label: string }[];
  value: T | "";
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {step}
      </p>
      <div className="inline-flex max-w-full flex-wrap justify-center gap-1 rounded-full border border-border bg-muted/60 p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-label={o.label}
            aria-pressed={value === o.value}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors sm:px-5",
              // No motion span: the selected highlight sits in place instantly —
              // it must never fly in from another pill (or "from down the page").
              value === o.value
                ? "bg-primary text-primary-foreground shadow-[var(--shadow-glow)]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

/*
 * Compress a student-card photo to WebP before upload: resize so the long
 * side is at most 700px and re-encode at quality 0.6. A card photo lands
 * around 25-80 KB instead of the original multi-MB file, so the whole
 * student-cards bucket stays far under its storage quota even with hundreds
 * of students (and the card stays readable enough for admin review). Falls
 * back to the original file if WebP encoding is unavailable (ancient
 * browsers) — the server still accepts it.
 */
async function compressToWebp(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const maxSide = 700;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.6),
  );
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".webp", {
    type: "image/webp",
  });
}

function Index() {
  const verify = useServerFn(verifyStudent);
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = Route.useLoaderData().groups;

  // Intro: two dark pages (big-logo splash, then the about page), then the
  // verification page. Each dark page unmounts once scrolled past, so neither
  // can be scrolled back to.
  const pageRef = useRef<HTMLDivElement>(null);
  const [introGone, setIntroGone] = useState(false);

  // Distinct levels and rotations actually configured in the DB.
  // Labels from the groups table win; rotation short label is the fallback.
  const levels = [...new Set(groups.map((g) => g.level))];
  const levelOptions = levels.map((lv) => ({
    value: lv,
    label:
      groups.find((g) => g.level === lv)?.label.match(/^(.*?)\s*[—–-]/)?.[1]?.trim() ||
      (lv === "4" ? "4e année" : lv === "3" ? "3e année" : lv),
  }));
  const rotationsForLevel = (lv: string) =>
    [...new Set(groups.filter((g) => g.level === lv).map((g) => g.rotation))].map((r) => ({
      value: r,
      label: groups.find((g) => g.level === lv && g.rotation === r)?.label.match(/[—–-]\s*(.*)$/)?.[1]?.trim() ||
        (r === "rot1" ? "Rotation 1" : r === "rot2" ? "Rotation 2" : r === "rot3" ? "Rotation 3" : r),
    }));

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const gameBtnRef = useRef<HTMLAnchorElement>(null);
  const [fullName, setFullName] = useState("");
  // Default to the first configured level/rotation so the form opens ready.
  const [level, setLevel] = useState(levels[0] ?? "");
  const [rotation, setRotation] = useState(
    levels[0] ? (rotationsForLevel(levels[0])[0]?.value ?? "") : "",
  );
  const selectedLevel = level as string;
  const rotationOptions = selectedLevel ? rotationsForLevel(selectedLevel) : [];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Floating game button: infinite wiggle + magnetic pull on hover.
  // Reference code kept verbatim; the "zone" is a padded hit-area around the
  // button so the magnet reacts before the cursor overlaps it. The wiggle runs
  // unconditionally (an OS-level "reduce motion" setting must not silently
  // kill it — the user chose this motion); only the magnetic pull is scoped to
  // pointer:fine devices, where a cursor actually exists.
  useEffect(() => {
    const btn = gameBtnRef.current;
    if (!btn) return;

    // Invisible hit-area ring around the button — centered on it at any
    // breakpoint (the anchor moves: bottom-5 on mobile, bottom-24 on sm+).
    const zone = document.createElement("div");
    zone.style.cssText =
      "position:fixed;width:6rem;height:6rem;border-radius:9999px;z-index:19;";
    const syncZone = () => {
      const r = btn.getBoundingClientRect();
      zone.style.left = `${r.left + r.width / 2 - 48}px`;
      zone.style.top = `${r.top + r.height / 2 - 48}px`;
    };
    syncZone();
    window.addEventListener("resize", syncZone);
    document.body.appendChild(zone);

    // wiggle loop — never gated. yoyo makes each pass retrace 0°->12°->0° so
    // the loop is seamless; without it the tween ends tilted at 12° and snaps
    // back to 0° every cycle (that snap reads as "not wiggling right").
    const wiggle = gsap.to(btn, {
      rotation: 12,
      duration: 0.4,
      repeat: -1,
      yoyo: true,
      ease: "wiggle({wiggles:8, type:easeOut})",
    });

    const mm = gsap.matchMedia();

    // magnetic pull — overwrite: "auto" keeps the wiggle!
    mm.add("(pointer: fine)", () => {
      const strength = 0.6;

      const onMove = (e: MouseEvent) => {
        const rect = zone.getBoundingClientRect();
        const x = gsap.utils.mapRange(rect.left, rect.right, -rect.width / 2, rect.width / 2, e.clientX);
        const y = gsap.utils.mapRange(rect.top, rect.bottom, -rect.height / 2, rect.height / 2, e.clientY);

        gsap.to(btn, {
          x: x * strength,
          y: y * strength,
          duration: 0.4,
          ease: "power2.out",
          overwrite: "auto",
        });
      };

      const onLeave = () => {
        gsap.to(btn, {
          x: 0,
          y: 0,
          duration: 0.7,
          ease: "elastic.out(1, 0.4)",
          overwrite: "auto",
        });
        // wiggle is still running
      };

      zone.addEventListener("mousemove", onMove);
      zone.addEventListener("mouseleave", onLeave);

      return () => {
        zone.removeEventListener("mousemove", onMove);
        zone.removeEventListener("mouseleave", onLeave);
      };
    });

    return () => {
      mm.revert();
      wiggle.kill();
      window.removeEventListener("resize", syncZone);
      zone.remove();
    };
  }, []);

  function onPick(selected: File | null) {
    setError(null);
    if (!selected) return;
    if (!["image/jpeg", "image/png"].includes(selected.type)) {
      setError("Format non accepté. Utilisez une image JPG ou PNG.");
      return;
    }
    if (selected.size > MAX_BYTES) {
      setError("Image trop lourde. Taille maximale : 5 Mo.");
      return;
    }
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError("Ajoutez une photo de votre carte d'étudiant.");
      return;
    }
    if (!level) {
      setError("Sélectionnez votre niveau.");
      return;
    }
    if (!rotation) {
      setError("Sélectionnez votre rotation.");
      return;
    }
    if (fullName.trim().length < 3) {
      setError("Entrez votre nom et prénom.");
      return;
    }

    setLoading(true);
    try {
      // Compress the card photo to WebP first (resize + re-encode): storage
      // stays small even with hundreds of students.
      const webpFile = await compressToWebp(file);
      const photoBase64 = await fileToBase64(webpFile);
      const result = (await verify({
        data: { fullName: fullName.trim(), level, rotation, photoBase64, photoType: webpFile.type },
      })) as VerifyResult;

      if (result.status === "ok") {
        setInvite(result.invite_link);
      } else if (result.status === "not_found") {
        setError("Nom introuvable dans la liste. Vérifiez l'orthographe (nom de famille puis prénom).");
      } else if (result.status === "already_joined") {
        setError("Vous avez déjà rejoint le groupe. Un seul lien par étudiant.");
        setBlocked(true);
      } else if (result.status === "rate_limited") {
        setError("Trop de tentatives. Réessayez dans une heure.");
        setBlocked(true);
      } else {
        setError(result.message);
      }
    } catch {
      setError("Une erreur est survenue. Réessayez dans un instant.");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      {!introGone && <Intro targetRef={pageRef} onDone={() => setIntroGone(true)} />}
      <div ref={pageRef} className="flex min-h-screen flex-col bg-background px-4 py-4">
      <main className="mx-auto w-full max-w-[480px] flex-1">
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Accès promotion
          </p>
          <h1 className="mt-2 text-[1.75rem] leading-[1.1] font-bold text-foreground">
            Vérification étudiante
          </h1>
        </header>

        {invite ? (
          <section className="mt-5">
              <div className="ticket-surface ticket-notch rounded-lg border-primary/25 bg-card/80 p-5 backdrop-blur-sm">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
                Identité vérifiée
              </p>
              <h2 className="mt-3 text-xl font-bold text-foreground">Votre lien d'invitation</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Émis pour vous, valable une seule fois.
              </p>

              <div className="mt-4 border-t border-dashed border-border pt-4">
                <div className="rounded-md border border-border bg-secondary p-3">
                  <p className="break-all font-mono text-xs leading-relaxed text-foreground">
                    {invite}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copyLink}
                  className="mt-2 w-full rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
                >
                  {copied ? "Lien copié" : "Copier le lien"}
                </button>
              </div>
            </div>

            <a
              href={invite}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex w-full items-center justify-center rounded-md bg-primary px-4 py-4 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Rejoindre le groupe
            </a>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Ce lien est à usage unique, ne le partagez pas.
            </p>

            <a
              href="/jeu"
              className="mt-4 block text-center text-xs text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
            >
              En attendant, un petit jeu →
            </a>
          </section>
        ) : (
          <form onSubmit={onSubmit} className="mt-5 space-y-5">
            <fieldset disabled={loading || blocked} className="space-y-5">
              {groups.length === 0 ? (
                <p className="rounded-md border border-border bg-secondary px-4 py-3 text-sm text-muted-foreground">
                  Aucun groupe n'est ouvert pour le moment. Revenez plus tard.
                </p>
              ) : (
                <>
                  <PillSwitcher
                    step="1 · Ton niveau"
                    options={levelOptions}
                    value={selectedLevel}
                    onChange={(v) => {
                      setLevel(v);
                      setRotation("");
                      setError(null);
                    }}
                  />

                  <PillSwitcher
                    step="2 · Ta rotation"
                    options={rotationOptions}
                    value={rotation}
                    onChange={(v) => {
                      setRotation(v);
                      setError(null);
                    }}
                  />
                </>
              )}

              <div>
                <label
                  htmlFor="card"
                  className="block text-sm font-medium text-foreground"
                >
                  Photo de la carte d'étudiant
                </label>
                <p className="mt-1 text-xs text-muted-foreground">JPG ou PNG, 5 Mo maximum.</p>

                <input
                  ref={inputRef}
                  id="card"
                  type="file"
                  accept="image/jpeg,image/png"
                  className="sr-only"
                  onChange={(e) => onPick(e.target.files?.[0] ?? null)}
                />

                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="mt-2 flex w-full items-center gap-4 rounded-md border border-dashed border-border bg-card/80 p-3 text-left backdrop-blur-sm transition-colors hover:border-primary"
                >
                  {preview ? (
                    <img
                      src={preview}
                      alt="Aperçu de la carte d'étudiant"
                      className="h-16 w-16 rounded-md border border-border object-cover"
                    />
                  ) : (
                    <span className="flex h-16 w-16 items-center justify-center rounded-md border border-border bg-secondary font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Photo
                    </span>
                  )}
                  <span className="text-sm">
                    <span className="block font-medium text-foreground">
                      {file ? "Changer la photo" : "Choisir une photo"}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {file ? file.name : "Carte lisible, bien cadrée"}
                    </span>
                  </span>
                </button>
              </div>

              <div>
                <label htmlFor="name" className="block text-sm font-medium text-foreground">
                  Nom et prénom
                </label>
                <input
                  id="name"
                  type="text"
                  value={fullName}
                  maxLength={120}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="ex : REHAIL Takie Eddine"
                  className="mt-2 w-full rounded-md border border-input bg-card/80 px-3.5 py-2.5 text-base text-foreground outline-none backdrop-blur-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring/20"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Écrivez votre nom tel qu'il figure sur la liste envoyée par le département.
                </p>
              </div>

              {error ? (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm text-destructive"
                >
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2.5 rounded-md bg-primary px-4 py-3 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                    Vérification en cours
                  </>
                ) : (
                  "Vérifier"
                )}
              </button>
            </fieldset>
          </form>
        )}
      </main>

      <footer className="mx-auto mt-6 w-full max-w-[480px] border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          Un problème ? Contactez l'administration.
        </p>
      </footer>

      {/* Always-visible floating game button (bottom-right) — wiggle + magnetic hover */}
      <a
        ref={gameBtnRef}
        href="/jeu"
        aria-label="Perds du temps en jouant"
        className="fixed right-5 bottom-5 z-20 flex items-center gap-2 rounded-full bg-[#39ff14] px-5 py-3 text-sm font-bold text-[#062b00] shadow-[0_0_18px_rgba(57,255,20,0.55),0_0_44px_rgba(57,255,20,0.3)] transition-shadow hover:shadow-[0_0_24px_rgba(57,255,20,0.8),0_0_60px_rgba(57,255,20,0.4)] sm:bottom-24"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4"
          aria-hidden="true"
        >
          <path d="M6 12h4M8 10v4" />
          <circle cx="15" cy="13" r="0.5" fill="currentColor" />
          <circle cx="17.5" cy="11" r="0.5" fill="currentColor" />
          <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
        </svg>
        Perds du temps
      </a>
      </div>
    </>
  );
}
