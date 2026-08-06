import { Logo } from "@/components/brand/logo";
import { LogoutButton } from "@/components/layout/logout-button";

const HUB_STORE_URL = process.env.NEXT_PUBLIC_HUB_STORE_URL;

/**
 * Coque Griot — une seule colonne, un seul écran (/griot).
 * Le solde du hub est affiché en permanence (§8) ; « Recharger » mène à la
 * boutique du hub (l'unique endroit où l'on achète des crédits).
 */
export function AppShell({
  children,
  solde,
}: {
  children: React.ReactNode;
  solde: number | null;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-cream-200/70 bg-cream-50/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-2 px-4">
          <Logo href="/griot" />
          <div className="flex items-center gap-2">
            <span
              className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-sky-700 shadow-soft"
              title="Ton solde de crédits DigiAfrik"
            >
              {solde ?? "–"} crédits
            </span>
            {HUB_STORE_URL ? (
              <a
                href={HUB_STORE_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-mint-100 px-3 py-1.5 text-sm font-semibold text-mint-800 shadow-soft"
              >
                Recharger
              </a>
            ) : null}
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
    </div>
  );
}
