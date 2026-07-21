import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { getSessionUser } from "@/lib/firebase/session";
import { formatCredits } from "@/lib/utils";
import { LicenseService } from "@/services/license-service";

const STORE_URL = process.env.NEXT_PUBLIC_CHARIOW_STORE_URL;

export default async function DashboardPage() {
  let universes: Array<{ id: string; title: string; description: string | null; cover_image: string | null }> = [];
  let books: Array<{ id: string; title: string; status: string; cover_image: string | null; page_count: number }> = [];
  let credits = 30;
  let name = "Créateur";
  let needsLicense = false;

  const session = await getSessionUser();
  if (session && isFirebaseAdminConfigured()) {
    const db = getAdminDb();
    const [uSnap, bSnap, profile] = await Promise.all([
      db.collection("universes").where("user_id", "==", session.uid).get(),
      db.collection("books").where("user_id", "==", session.uid).get(),
      db.collection("users").doc(session.uid).get(),
    ]);
    universes = uSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<(typeof universes)[0], "id">) }))
      .sort((a, b) => 0)
      .slice(0, 6);
    books = bSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<(typeof books)[0], "id">) }))
      .slice(0, 6);
    credits = (profile.data()?.credits as number) ?? 0;
    name = ((profile.data()?.fullname as string) || "Créateur").split(" ")[0];

    if (LicenseService.isConfigured()) {
      const status = await new LicenseService(db).getStatus(
        session.uid,
        session.email as string | undefined
      );
      needsLicense = status.required && !status.valid;
    }
  }

  return (
    <div className="space-y-10">
      {needsLicense ? (
        <Card className="border-sky-200 bg-sky-50">
          <p className="font-semibold text-sky-900">Licence Chariow requise</p>
          <p className="mt-1 text-sm text-ink-muted">
            Activez la clé reçue après votre achat sur Chariow pour lancer des
            générations. Vos créations restent accessibles.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/license">
              <Button size="sm">Activer ma licence</Button>
            </Link>
            {STORE_URL ? (
              <a href={STORE_URL} target="_blank" rel="noreferrer">
                <Button size="sm" variant="secondary">
                  Acheter sur Chariow
                </Button>
              </a>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl text-ink md:text-4xl">Bonjour {name} ✦</h1>
          <p className="mt-2 text-ink-muted">Que souhaitez-vous créer aujourd&apos;hui ?</p>
        </div>
        <Link href="/universes/new"><Button size="lg">Créer un nouvel univers</Button></Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><p className="text-sm text-ink-muted">Crédits</p><p className="mt-1 font-display text-3xl text-sky-700">{formatCredits(credits)}</p></Card>
        <Card><p className="text-sm text-ink-muted">Univers</p><p className="mt-1 font-display text-3xl">{universes.length}</p></Card>
        <Card><p className="text-sm text-ink-muted">Livres</p><p className="mt-1 font-display text-3xl">{books.length}</p></Card>
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl">Vos univers</h2>
          <Link href="/universes/new" className="text-sm font-semibold text-sky-600">Nouveau</Link>
        </div>
        {universes.length === 0 ? (
          <EmptyState title="Votre premier univers n'attend plus que vous" description="Un univers contient vos personnages, histoires et livres." actionLabel="Créer un univers" actionHref="/universes/new" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {universes.map((u) => (
              <Link key={u.id} href={`/universes/${u.id}`}>
                <Card className="h-full transition hover:-translate-y-1 hover:shadow-lift">
                  <div className="mb-4 aspect-[4/3] overflow-hidden rounded-2xl bg-gradient-to-br from-sky-100 to-lavender-100">
                    {u.cover_image ? <img src={u.cover_image} alt="" className="h-full w-full object-cover" /> : null}
                  </div>
                  <h3 className="font-display text-lg">{u.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{u.description || "Univers créatif"}</p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl">Derniers livres</h2>
        {books.length === 0 ? (
          <p className="text-sm text-ink-muted">Aucun livre pour le moment. Créez un univers pour commencer.</p>
        ) : (
          <div className="grid gap-3">
            {books.map((b) => (
              <Link key={b.id} href={`/books/${b.id}`}>
                <Card className="flex items-center gap-4 transition hover:shadow-lift">
                  <div className="h-16 w-12 rounded-xl bg-gradient-to-br from-mint-100 to-sky-100" />
                  <div className="flex-1">
                    <h3 className="font-semibold">{b.title}</h3>
                    <p className="text-sm text-ink-muted">{b.page_count} pages · {b.status}</p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
