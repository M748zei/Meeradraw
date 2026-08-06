"use client";

import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Se déconnecter"
      title="Se déconnecter"
      className="rounded-full p-2 text-ink-muted transition hover:bg-cream-100 hover:text-ink"
      onClick={async () => {
        await getSupabaseBrowser().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut className="h-4 w-4" />
    </button>
  );
}
