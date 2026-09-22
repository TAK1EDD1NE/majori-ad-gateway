/**
 * Cloudinary bindings for student-card photos (server-side only).
 *
 * Replaces the Supabase "student-cards" storage bucket. Cards are uploaded
 * as PRIVATE (type: 'private') assets: they are never served by a public URL;
 * the only way to view one is a short-lived signed delivery URL, matching the
 * old private-bucket behavior (readable by admin only, never by anon clients).
 *
 * Only imported from server functions/route handlers — never from code that
 * ships to the client bundle. Credentials are read from process.env.
 */
import cloudinary from "cloudinary";

export type CardUpload =
  | { ok: true; publicId: string; secureUrl: string }
  | { ok: false; error: string };

/**
 * Upload a student card as a private Cloudinary asset.
 *
 * @param bytes      raw image bytes (webp/jpeg/png)
 * @param publicId   destination path, e.g. `student-cards/{student_id}/{timestamp}`
 * @param contentType image content type
 */
export async function uploadStudentCard(
  bytes: Buffer,
  publicId: string,
  contentType: string,
): Promise<CardUpload> {
  const cloud = getCloudinary();
  if (!cloud) return { ok: false, error: "Cloudinary non configuré." };

  try {
    const result = await new Promise<{ public_id: string; secure_url: string }>(
      (resolve, reject) => {
        const stream = cloud.uploader.upload_stream(
          {
            public_id: publicId,
            resource_type: "image",
            type: "private",
            overwrite: false,
            format: contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg",
          },
          (err, res) => {
            if (err) reject(err);
            else if (!res || typeof res.public_id !== "string") reject(new Error("Cloudinary upload returned an empty result."));
            else resolve({ public_id: res.public_id, secure_url: res.secure_url });
          },
        );
        stream.end(bytes);
      },
    );

    return { ok: true, publicId: result.public_id, secureUrl: result.secure_url };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Produce a short-lived signed delivery URL for a private card.
 * Signed URLs expire (default 1h) and are the only way to view a private asset.
 */
export function getSignedCardUrl(publicId: string, expiresInSec = 3600): string | null {
  const cloud = getCloudinary();
  if (!cloud) return null;
  try {
    return cloud.url(publicId, {
      resource_type: "image",
      type: "private",
      sign_url: true,
      expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
    });
  } catch {
    return null;
  }
}

let _cloud: ReturnType<typeof configure> | null | undefined;
function configure() {
  const name = process.env["CLOUDINARY_CLOUD_NAME"];
  const key = process.env["CLOUDINARY_API_KEY"];
  const secret = process.env["CLOUDINARY_API_SECRET"];
  if (!name || !key || !secret) {
    console.error("[cloudinary] Missing CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET.");
    return null;
  }
  cloudinary.v2.config({ cloud_name: name, api_key: key, api_secret: secret });
  return cloudinary.v2;
}

function getCloudinary() {
  if (_cloud === undefined) _cloud = configure();
  return _cloud;
}