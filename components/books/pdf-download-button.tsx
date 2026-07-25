"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  bookId: string;
  pdfUrl?: string | null;
  label?: string;
};

export function PdfDownloadButton({ bookId, pdfUrl, label = "Télécharger le PDF" }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (pdfUrl) {
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pdf/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId }),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error?.message || "Export impossible");
      }
      const url = json.data.pdf_url as string;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export impossible");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button size="lg" onClick={download} disabled={loading}>
        {loading ? "Préparation du PDF…" : label}
      </Button>
      {error ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
