import { AppError } from "@/lib/errors";
import { getAdminStorage } from "@/lib/firebase/admin";
import { detectImageFormat, toPngBuffer } from "@/lib/image-format";

export class StorageService {
  /**
   * Persist a (possibly ephemeral) image URL into Firebase Storage under a
   * canonical path (audit fix T7 — fal.media URLs are purged and every book
   * visually broke). Downloads server-side, normalizes to PNG, uploads, and
   * returns BOTH the signed URL (for direct display) and the Storage path
   * (persisted in Firestore so URLs can be re-signed later).
   *
   * Fail-open: on any failure the ORIGINAL url is returned with path=null —
   * a working ephemeral URL beats a broken page.
   */
  async persistImageFromUrl(
    url: string,
    path: string
  ): Promise<{ url: string; path: string | null }> {
    try {
      // Already ours (previous persist or fal-provider webp upload) → keep as is,
      // but recover the object path from the signed URL so Firestore can re-sign
      // it later (format: https://storage.googleapis.com/<bucket>/<path>?X-Goog-…).
      if (url.includes("storage.googleapis.com") || url.startsWith("gs://")) {
        try {
          const u = new URL(url);
          const segments = u.pathname.split("/").filter(Boolean);
          const existingPath = decodeURIComponent(segments.slice(1).join("/"));
          return { url, path: existingPath || null };
        } catch {
          return { url, path: null };
        }
      }
      // SSRF guard: only pull images from known providers — never internal
      // hosts or arbitrary user-influenced URLs.
      const host = new URL(url).hostname;
      const allowed =
        host === "fal.media" ||
        host.endsWith(".fal.media") ||
        host === "storage.googleapis.com" ||
        host === "firebasestorage.googleapis.com" ||
        host === "placehold.co";
      if (!allowed) throw new Error(`host not allowed: ${host}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const raw = new Uint8Array(await res.arrayBuffer());
      const png =
        detectImageFormat(raw) === "png" ? Buffer.from(raw) : await toPngBuffer(raw);
      const signedUrl = await this.uploadBytes(path, png, "image/png");
      return { url: signedUrl, path };
    } catch (err) {
      console.warn(`persistImageFromUrl failed for ${path}; keeping source URL`, err);
      return { url, path: null };
    }
  }

  async uploadBytes(
    path: string,
    bytes: Uint8Array | Buffer,
    contentType: string
  ): Promise<string> {
    try {
      const bucket = getAdminStorage().bucket();
      const file = bucket.file(path);
      await file.save(Buffer.from(bytes), {
        contentType,
        resumable: false,
        metadata: {
          cacheControl: "private, max-age=3600",
          metadata: { ownerPath: path },
        },
      });

      // Owner-only Storage rules: signed URL instead of makePublic()
      const [url] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 1000 * 60 * 60 * 24 * 365, // 1 year
      });
      return url;
    } catch (err) {
      console.error("storage upload failed", err);
      throw new AppError("INTERNAL_ERROR", "Upload impossible", 500);
    }
  }
}
