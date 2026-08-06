import { detectImageFormat, toPngBuffer } from "@/lib/image-format";
import { overlayCoverTitle } from "@/lib/cover-title";

/**
 * Persist a cover image, optionally compositing a server-side title band.
 *
 * When `overlayTitle` is set and `requireTitledOverlay` is true (premium /
 * parent colorbooks on the reference path), overlay or upload failures MUST
 * throw — never fall back to an untitled source cover.
 *
 * Non-strict books keep the historical fail-open fallback.
 */
export type CoverPersistDeps = {
  fetchCoverBytes: (url: string) => Promise<Uint8Array>;
  uploadPng: (path: string, png: Buffer) => Promise<string>;
  persistFromUrl: (
    url: string,
    path: string
  ) => Promise<{ url: string; path: string | null }>;
  /** Injectable for tests — defaults to overlayCoverTitle. */
  overlay?: (png: Buffer, title: string) => Promise<Buffer>;
};

export type CoverPersistInput = {
  coverUrl: string;
  storagePath: string;
  /** Exact plan.title when server overlay is required; null = provider-lettered path. */
  overlayTitle: string | null;
  requireTitledOverlay: boolean;
};

export async function persistCoverWithOptionalTitle(
  input: CoverPersistInput,
  deps: CoverPersistDeps
): Promise<{ url: string; path: string | null }> {
  const title =
    typeof input.overlayTitle === "string" ? input.overlayTitle.trim() : "";
  if (!title) {
    if (input.requireTitledOverlay) {
      throw new Error(
        "Premium cover requires an exact plan.title for server overlay"
      );
    }
    return deps.persistFromUrl(input.coverUrl, input.storagePath);
  }

  const overlay = deps.overlay ?? overlayCoverTitle;

  try {
    const raw = await deps.fetchCoverBytes(input.coverUrl);
    const png =
      detectImageFormat(raw) === "png"
        ? Buffer.from(raw)
        : await toPngBuffer(raw);
    const titled = await overlay(png, title);
    const url = await deps.uploadPng(input.storagePath, titled);
    return { url, path: input.storagePath };
  } catch (err) {
    if (input.requireTitledOverlay) {
      const message =
        err instanceof Error ? err.message : "Cover title overlay failed";
      throw new Error(
        `Premium cover title overlay failed — refusing untitled cover (${message})`
      );
    }
    console.warn("cover title overlay failed; persisting untitled cover", err);
    return deps.persistFromUrl(input.coverUrl, input.storagePath);
  }
}
