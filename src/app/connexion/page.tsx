'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '../../lib/supabase-browser';

/**
 * Connexion par code reçu par email.
 *
 * Pourquoi pas un lien magique : Gmail (et la plupart des antispam) ouvrent les
 * liens des emails avant l'utilisateur pour les analyser. Le jeton étant à usage
 * unique, il est déjà consommé quand la personne clique — elle voit
 * « Email link is invalid or has expired ». Un code qu'on recopie à la main ne
 * peut pas être consommé par un robot.
 *
 * Bonus : ça marche quand on lit ses mails sur le téléphone et qu'on navigue
 * sur l'ordinateur, ce qu'un lien magique ne permet pas.
 */

const DUREE_RENVOI = 45; // secondes avant de pouvoir redemander un code

/**
 * On appelle l'API d'authentification en direct, sans passer par
 * `signInWithOtp` / `verifyOtp` du SDK.
 *
 * Raison : `createBrowserClient` de @supabase/ssr force `flowType: 'pkce'` —
 * la valeur est écrite en dur, après le spread des options, donc impossible à
 * changer. En mode PKCE le SDK ajoute un `code_challenge` à la demande de code,
 * et le serveur range alors le jeton préfixé `pkce_…` en base. La vérification
 * d'un code à recopier compare, elle, un hachage sans préfixe : ça ne peut
 * jamais correspondre. D'où le « ce code a expiré » 20 secondes après l'envoi.
 *
 * En parlant directement à l'API, sans `code_challenge`, le jeton est rangé
 * normalement et le code fonctionne. On rend ensuite la session au SDK avec
 * `setSession`, qui écrit le cookie que lisent les pages serveur.
 */
const AUTH = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
const ENTETES = {
  apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
  'content-type': 'application/json',
};

function Formulaire() {
  const router = useRouter();
  const params = useSearchParams();
  const codePromo = (params.get('code') ?? params.get('promo') ?? '').trim().toUpperCase();

  const [etape, setEtape] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [codeSaisi, setCodeSaisi] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState('');
  const [compteARebours, setCompteARebours] = useState(0);
  const champCode = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (compteARebours <= 0) return;
    const t = setTimeout(() => setCompteARebours((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [compteARebours]);

  useEffect(() => {
    if (etape === 'code') champCode.current?.focus();
  }, [etape]);

  async function envoyerCode(e?: React.FormEvent) {
    e?.preventDefault();
    const adresse = email.trim();
    if (!adresse) return;

    setOccupe(true);
    setMessage('');

    let statut = 0;
    try {
      const r = await fetch(`${AUTH}/otp`, {
        method: 'POST',
        headers: ENTETES,
        body: JSON.stringify({ email: adresse, create_user: true }),
      });
      statut = r.status;
    } catch {
      statut = 0;
    }

    setOccupe(false);

    if (statut !== 200) {
      setMessage(
        statut === 429
          ? 'Trop de demandes coup sur coup. Attends une minute et réessaie.'
          : "On n'a pas pu envoyer le code. Vérifie ton adresse et réessaie.",
      );
      return;
    }

    setEtape('code');
    setCompteARebours(DUREE_RENVOI);
  }

  async function verifierCode(e?: React.FormEvent) {
    e?.preventDefault();
    const jeton = codeSaisi.replace(/\D/g, '');
    if (jeton.length < 6) {
      setMessage('Recopie le code en entier.');
      return;
    }

    setOccupe(true);
    setMessage('');

    // Selon l'état du compte, le serveur range le code à deux endroits
    // différents (compte tout neuf → jeton de confirmation ; compte déjà
    // confirmé → jeton de reconnexion). Le type 'email' couvre les deux, mais on
    // garde les autres en secours : un mauvais type renvoie « jeton invalide »
    // sans rien consommer, donc essayer ne coûte rien.
    let session: { access_token: string; refresh_token: string } | null = null;
    for (const type of ['email', 'magiclink', 'signup'] as const) {
      try {
        const r = await fetch(`${AUTH}/verify`, {
          method: 'POST',
          headers: ENTETES,
          body: JSON.stringify({ type, email: email.trim(), token: jeton }),
        });
        if (!r.ok) continue;
        const donnees = await r.json();
        if (donnees?.access_token && donnees?.refresh_token) {
          session = {
            access_token: donnees.access_token,
            refresh_token: donnees.refresh_token,
          };
          break;
        }
      } catch {
        /* réseau : on tente le type suivant, puis on affiche l'erreur */
      }
    }

    // On rend la session au SDK : c'est lui qui écrit le cookie lu par les
    // pages serveur (/compte) et par les routes API.
    if (session) {
      const { error } = await supabaseBrowser().auth.setSession(session);
      if (error) session = null;
    }

    if (!session) {
      setOccupe(false);
      setCodeSaisi('');
      setMessage(
        "Ce code ne correspond pas, ou il a expiré. Vérifie le code du dernier email reçu, ou demande-en un nouveau.",
      );
      return;
    }

    // La session existe : on peut consommer le code promo au nom de la personne.
    if (codePromo) {
      try {
        await fetch('/api/codes/utiliser', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: codePromo }),
        });
      } catch {
        /* le solde reste juste sans le bonus ; on ne bloque pas la connexion */
      }
    }

    router.push('/compte');
    router.refresh();
  }

  return (
    <main className="sec">
      <div className="wrap" style={{ maxWidth: 560 }}>
        <span className="kick">Ton compte DigiAfrik</span>
        <h2>
          {etape === 'email' ? (
            <>
              Un code, et c&rsquo;est <em>ouvert</em>.
            </>
          ) : (
            <>
              Le code est dans <em>ta boîte mail</em>.
            </>
          )}
        </h2>

        {codePromo ? (
          <div className="codemsg ok" style={{ display: 'block', marginTop: 22 }}>
            Code <strong>{codePromo}</strong> gardé de côté — tes crédits arrivent dès que tu te
            connectes.
          </div>
        ) : null}

        {etape === 'email' ? (
          <form onSubmit={envoyerCode} style={{ marginTop: 26 }}>
            <p className="lede" style={{ marginTop: 0, fontSize: 16 }}>
              Pas de mot de passe à inventer. Tu entres ton email, on t&rsquo;envoie un code, tu le
              recopies.
            </p>
            <div className="codeform" style={{ marginTop: 18 }}>
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                placeholder="ton@email.com"
                aria-label="Adresse email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                style={{ textTransform: 'none', letterSpacing: 'normal' }}
              />
              <button type="submit" className="btn o" disabled={occupe}>
                {occupe ? 'Envoi…' : 'Recevoir mon code'}
              </button>
            </div>
            {message ? (
              <div className="codemsg ko" style={{ display: 'block' }}>
                {message}
              </div>
            ) : null}
            <p className="mini" style={{ marginTop: 16 }}>
              Sans carte bancaire · 0 F d&rsquo;abonnement
            </p>
          </form>
        ) : (
          <form onSubmit={verifierCode} style={{ marginTop: 26 }}>
            <p className="lede" style={{ marginTop: 0, fontSize: 16 }}>
              On vient d&rsquo;envoyer un code à <strong>{email}</strong>. Recopie-le ici. Tu peux
              lire l&rsquo;email sur ton téléphone et taper le code ici, ça marche.
            </p>
            <div className="codeform" style={{ marginTop: 18 }}>
              <input
                ref={champCode}
                type="text"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                placeholder="000000"
                aria-label="Code reçu par email"
                value={codeSaisi}
                onChange={(ev) => {
                  const v = ev.target.value.replace(/\D/g, '').slice(0, 10);
                  setCodeSaisi(v);
                  setMessage('');
                }}
              />
              <button type="submit" className="btn o" disabled={occupe || codeSaisi.length < 6}>
                {occupe ? 'Vérification…' : 'Ouvrir mon compte'}
              </button>
            </div>
            {message ? (
              <div className="codemsg ko" style={{ display: 'block' }}>
                {message}
              </div>
            ) : null}

            <p className="mini" style={{ marginTop: 16 }}>
              {compteARebours > 0 ? (
                <>Pas reçu&nbsp;? Tu pourras en redemander un dans {compteARebours}&nbsp;s.</>
              ) : (
                <>
                  Pas reçu&nbsp;? Regarde dans les spams, ou{' '}
                  <a
                    href="#"
                    onClick={(ev) => {
                      ev.preventDefault();
                      if (!occupe) void envoyerCode();
                    }}
                  >
                    renvoie un code
                  </a>
                  .
                </>
              )}
              {' · '}
              <a
                href="#"
                onClick={(ev) => {
                  ev.preventDefault();
                  setEtape('email');
                  setCodeSaisi('');
                  setMessage('');
                }}
              >
                Changer d&rsquo;adresse
              </a>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Formulaire />
    </Suspense>
  );
}
