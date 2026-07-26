const PDF_EXPORTABLE_STATUSES = new Set(["completed", "partial", "archived"]);

export const PDF_EXPORT_LEASE_MS = 3 * 60_000;

export type PdfExportPageState = {
  illustration_url?: string | null;
  illustration_path?: string | null;
  generation_status?: string | null;
};

export function validatePdfExportState(
  bookStatus: string | null | undefined,
  pages: PdfExportPageState[]
): "ok" | "book_not_ready" | "page_retry_active" | "no_printable_pages" {
  if (!PDF_EXPORTABLE_STATUSES.has(String(bookStatus ?? ""))) {
    return "book_not_ready";
  }
  if (pages.some((page) => page.generation_status === "generating")) {
    return "page_retry_active";
  }
  if (
    pages.length === 0 ||
    !pages.some((page) => Boolean(page.illustration_path || page.illustration_url))
  ) {
    return "no_printable_pages";
  }
  return "ok";
}

export function isPdfExportLeaseActive(
  token: unknown,
  startedAt: unknown,
  now = Date.now()
): boolean {
  if (typeof token !== "string" || token.length === 0) return false;
  const started = Date.parse(typeof startedAt === "string" ? startedAt : "");
  return Number.isFinite(started) && now - started < PDF_EXPORT_LEASE_MS;
}
