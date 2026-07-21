import { AppError } from "@/lib/errors";
import { getAdminStorage } from "@/lib/firebase/admin";

export class StorageService {
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
