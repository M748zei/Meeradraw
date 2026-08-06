import { requireUser } from "@/lib/api-auth";
import { apiError, AppError } from "@/lib/errors";
import { fetchSafeImageBytes } from "@/lib/safe-image-url";

/**
 * Proxy de lecture des images générées (hôtes fal uniquement, garde SSRF de
 * lib/safe-image-url) : garantit au <canvas> une origine propre pour fusionner
 * le texte, et force un vrai téléchargement sur mobile.
 */
export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url).searchParams.get("url") ?? "";
    const bytes = await fetchSafeImageBytes(url).catch(() => null);
    if (!bytes) {
      throw new AppError("VALIDATION_ERROR", "Image introuvable ou hôte refusé.", 400);
    }
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
