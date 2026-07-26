import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { formatCredits } from "@/lib/utils";
import { CreditCard, Home, Library, ShieldCheck, Sparkles, User } from "lucide-react";

const nav = [
  { href: "/dashboard", label: "Studio", icon: Home },
  { href: "/library", label: "Bibliothèque", icon: Library },
  { href: "/create", label: "Créer", icon: Sparkles },
  { href: "/license", label: "Mon accès", icon: ShieldCheck },
  { href: "/credits", label: "Crédits", icon: CreditCard },
  { href: "/profile", label: "Profil", icon: User },
];

export function AppShell({
  children,
  credits,
  name,
}: {
  children: React.ReactNode;
  credits?: number;
  name?: string | null;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-cream-200/70 bg-cream-50/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Logo href="/dashboard" />
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-xl px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-white hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/credits"
              className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-sky-700 shadow-soft transition hover:bg-sky-50 hover:shadow-lift"
              title="Voir et recharger vos crédits"
            >
              {formatCredits(credits ?? 0)} crédits
            </Link>
            <div className="hidden text-sm text-ink-muted sm:block">
              {name ? `Bonjour ${name.split(" ")[0]}` : "Bonjour"}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-cream-200 bg-white/95 backdrop-blur md:hidden">
        <div className="flex justify-around px-2 py-2">
          {nav.slice(0, 4).map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-medium text-ink-muted"
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="h-20 md:hidden" />
    </div>
  );
}
