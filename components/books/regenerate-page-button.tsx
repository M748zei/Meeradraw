"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

type Props = {
  bookId: string;
  pageId: string;
  size?: "sm" | "md";
  onSuccess?: () => void;
};

export function RegeneratePageButton({
  bookId,
  pageId,
  size = "sm",
  onSuccess,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRegen() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generation/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, page_id: pageId }),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error?.message || "Régénération impossible");
      }
      onSuccess?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="secondary"
        size={size}
        onClick={() => void onRegen()}
        disabled={loading}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        {loading ? "Régénération…" : "Régénérer cette page"}
      </Button>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
