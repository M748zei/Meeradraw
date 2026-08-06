import { redirect } from 'next/navigation';
import { supabaseServer } from '../../lib/supabase';

export const dynamic = 'force-dynamic';

type Transaction = {
  id: string;
  delta: number;
  label: string;
  kind: string;
  app: string | null;
  created_at: string;
};

type Pack = {
  slug: string;
  label: string;
  credits: number;
  price_xof: number;
  checkout_url: string | null;
};

function dateCourte(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

export default async function Page() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/connexion');

  const [{ data: wallet }, { data: transactions }, { data: packs }] = await Promise.all([
    supabase.from('hub_wallets').select('balance, currency').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('hub_transactions')
      .select('id, delta, label, kind, app, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('hub_credit_packs')
      .select('slug, label, credits, price_xof, checkout_url')
      .eq('is_active', true)
      .order('sort_order'),
  ]);

  const solde = wallet?.balance ?? 0;

  return (
    <main className="sec">
      <div className="wrap">
        <span className="kick">Mon compte</span>
        <h2>
          Ton solde,<br />
          et ce que tu en as fait.
        </h2>

        <div className="wal" style={{ marginTop: 40 }}>
          <div className="wcard">
            <div className="wtop">
              <span>SOLDE DIGIAFRIK</span>
              <span>{user.email}</span>
            </div>
            <div className="wbal">
              {solde} <s>crédits</s>
            </div>
            <div className="wbar">
              <i style={{ width: `${Math.min(100, (solde / 400) * 100)}%` }} />
            </div>
            <div className="wtop" style={{ fontSize: '11.5px', fontWeight: 600, opacity: 0.66 }}>
              <span>{solde === 0 ? 'Portefeuille vide' : 'Utilisable sur tous les outils'}</span>
              <span>N&rsquo;expire pas</span>
            </div>

            {/*
              Deux outils, deux boutons. Griot a été retiré de l'interface : le
              produit est abandonné, sa table reste en base et aucune donnée
              n'est supprimée. MeeraDraw passe devant — c'est lui qu'on met en
              avant dans les vidéos.
            */}
            <div className="hcta" style={{ marginTop: 22 }}>
              <a href="https://meeradraw.digiafrik.shop" className="btn p">
                Ouvrir MeeraDraw
              </a>
              <a href="https://klik.digiafrik.shop" className="btn b">
                Ouvrir Klik
              </a>
            </div>
          </div>

          <div className="calc">
            <h4>Recharger</h4>
            <div className="hint">Les crédits n&rsquo;expirent pas et servent sur tous les outils.</div>
            <div className="wlist">
              {(packs as Pack[] | null)?.map((p) => (
                <div className="wrow" key={p.slug}>
                  <span>
                    <strong>{p.label}</strong> — {p.credits.toLocaleString('fr-FR')} crédits
                  </span>
                  <a
                    className="btn sm o"
                    href={p.checkout_url ?? 'https://hymamcey.mychariow.shop'}
                    rel="noreferrer"
                  >
                    {p.price_xof.toLocaleString('fr-FR')} F
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>

        <h2 style={{ marginTop: 60, fontSize: 'clamp(24px,3.4vw,38px)' }}>Historique</h2>
        <div className="wlist" style={{ marginTop: 22 }}>
          {(transactions as Transaction[] | null)?.length ? (
            (transactions as Transaction[]).map((t) => (
              <div className="wrow" key={t.id}>
                <span>
                  {t.label}
                  {t.app && t.app !== 'hub' ? (
                    <span className={`tagfam ${t.app === 'klik' ? 'tagbiz' : ''}`}>{t.app}</span>
                  ) : null}
                  <em style={{ fontStyle: 'normal', opacity: 0.55, marginLeft: 8, fontSize: 12.5 }}>
                    {dateCourte(t.created_at)}
                  </em>
                </span>
                <b className={t.delta > 0 ? 'pos' : 'neg'}>
                  {t.delta > 0 ? `+${t.delta}` : t.delta}
                </b>
              </div>
            ))
          ) : (
            <div className="wrow">
              <span>Rien pour l&rsquo;instant. Ton premier mouvement apparaîtra ici.</span>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
