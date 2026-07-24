import { AppError } from "@/lib/errors";
import { getAdminStorage } from "@/lib/firebase/admin";
import { detectImageFormat, toPngBuffer } from "@/lib/image-format";
import {
  assertSafeImageUrl,
  fetchSafeImageBytes,
  isAllowedImageHost,
} from "@/lib/safe-image-url";

export class StorageService {
  /**
   * Persist a (possibly ephemeral) image URL into Firebase Storage under a
   * canonical path (audit fix T7 — fal.media URLs are purged and every book
   * visually broke). Downloads server-side, normalizes to PNG, uploads, and
   * returns BOTH the signed URL (for direct display) and the Storage path
   * (persisted in Firestore so URLs can be re-signed later).
   *
   * Fail-open only for allowlisted provider URLs (ephemeral fal beats a blank
   * page). Disallowed hosts fail closed — never store an untrusted URL.
   */
  async persistImageFromUrl(
    url: string,
    path: string
  ): Promise<{ url: string; path: string | null }> {
    // gs:// bucket paths are already ours.
    if (url.startsWith("gs://")) {
      const withoutScheme = url.slice("gs://".length);
      const slash = withoutScheme.indexOf("/");
      const existingPath = slash >= 0 ? withoutScheme.slice(slash + 1) : null;
      return { url, path: existingPath || null };
    }

    let parsed: URL;
    try {
      parsed = assertSafeImageUrl(url);
    } catch (err) {
      console.warn(`persistImageFromUrl rejected unsafe URL for ${path}`, err);
      throw new AppError("VALIDATION_ERROR", "URL d'image non autorisée", 400);
    }

    try {
      // Already ours (signed Storage URL) → keep as is, recover object path.
      if (
        parsed.hostname === "storage.googleapis.com" ||
        parsed.hostname === "firebasestorage.googleapis.com"
      ) {
        const segments = parsed.pathname.split("/").filter(Boolean);
        const existingPath = decodeURIComponent(segments.slice(1).join("/"));
        return { url, path: existingPath || null };
      }

      const raw = await fetchSafeImageBytes(url);
      const png =
        detectImageFormat(raw) === "png" ? Buffer.from(raw) : await toPngBuffer(raw);
      const signedUrl = await this.uploadBytes(path, png, "image/png");
      return { url: signedUrl, path };
    } catch (err) {
      // Only keep the source URL when it is still an allowlisted provider
      // (typically fal.media) — never persist an arbitrary/untrusted URL.
      if (isAllowedImageHost(parsed.hostname)) {
        console.warn(`persistImageFromUrl failed for ${path}; keeping source URL`, err);
        return { url, path: null };
      }
      console.warn(`persistImageFromUrl failed for ${path}`, err);
      throw new AppError("INTERNAL_ERROR", "Persistance image impossible", 500);
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
