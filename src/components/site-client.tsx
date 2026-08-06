'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FormEvent, ReactNode } from 'react';

/* ---------------------------------------------------------------- devises */

export type Currency = 'XOF' | 'XAF' | 'CDF';

type RateDef = { r: number; unit: string };

/* XOF et XAF sont à parité fixe (1:1). Le taux CDF est indicatif :
   à brancher sur un vrai taux en production. */
const RATES: Record<Currency, RateDef> = {
  XOF: { r: 1, unit: 'F' },
  XAF: { r: 1, unit: 'FCFA' },
  CDF: { r: 4.7, unit: 'FC' },
};

/** Espace fine insécable, séparateur de milliers du français. */
const NNBSP = ' ';

/** Groupe les milliers sans dépendre d'Intl (rendu serveur/client identique). */
function groupe(v: number, sep: string): string {
  const n = Math.round(v);
  const signe = n < 0 ? '-' : '';
  const chiffres = String(Math.abs(n));
  let out = '';
  for (let i = 0; i < chiffres.length; i++) {
    if (i > 0 && (chiffres.length - i) % 3 === 0) out += sep;
    out += chiffres[i];
  }
  return signe + out;
}

/** Convertit un montant en XOF vers la devise demandée et le formate. */
export function formatMontant(xof: number, cur: Currency): string {
  const pas = cur === 'CDF' ? 50 : 1;
  const v = Math.round((xof * RATES[cur].r) / pas) * pas;
  return groupe(v, ' ') + ' ' + RATES[cur].unit;
}

type CurrencyContextValue = {
  cur: Currency;
  setCur: (c: Currency) => void;
};

const CurrencyContext = createContext<CurrencyContextValue>({
  cur: 'XOF',
  setCur: () => undefined,
});

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [cur, setCur] = useState<Currency>('XOF');
  const value = useMemo<CurrencyContextValue>(() => ({ cur, setCur }), [cur]);
  return (
    <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
  );
}

const DEVISES: ReadonlyArray<{ code: Currency; label: string }> = [
  { code: 'XOF', label: 'F CFA' },
  { code: 'XAF', label: 'FCFA·XAF' },
  { code: 'CDF', label: 'FC' },
];

export function CurrencySwitcher() {
  const { cur, setCur } = useCurrency();
  return (
    <div className="cur" role="group" aria-label="Devise">
      {DEVISES.map((d) => (
        <button
          key={d.code}
          type="button"
          data-cur={d.code}
          aria-pressed={cur === d.code}
          onClick={() => setCur(d.code)}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}

export type PriceProps = {
  /** Montant de référence, exprimé en francs CFA (XOF). */
  xof: number;
  /** Préfixe le montant d'un « + » (lignes de commission). */
  plus?: boolean;
  className?: string;
  as?: 'span' | 'b';
};

export function Price({ xof, plus = false, className, as = 'span' }: PriceProps) {
  const { cur } = useCurrency();
  const texte = (plus ? '+' : '') + formatMontant(xof, cur);
  if (as === 'b') {
    return (
      <b className={className} data-xof={xof}>
        {texte}
      </b>
    );
  }
  return (
    <span className={className} data-xof={xof}>
      {texte}
    </span>
  );
}

/* ------------------------------------------------- révélations au scroll */

export function Reveal({ children }: { children: ReactNode }) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.rv'));
    if (els.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -5% 0px' },
    );

    els.forEach((el, i) => {
      el.style.transitionDelay = Math.min(i % 4, 3) * 60 + 'ms';
      io.observe(el);
    });

    return () => io.disconnect();
  }, []);

  return <>{children}</>;
}

/* ------------------------------------------------------------ code promo */

type VerificationCode = {
  ok: boolean;
  credits?: number;
  label?: string;
  raison?: string;
};

const RAISONS: Record<string, string> = {
  CODE_INCONNU:
    'Ce code n’est pas reconnu. Vérifie les lettres, ou écris-nous sur WhatsApp.',
  CODE_EXPIRE:
    'Ce code a expiré. Écris-nous sur WhatsApp, on t’en donne un encore valable.',
  CODE_EPUISE:
    'Ce code a déjà été utilisé au maximum de fois. Écris-nous sur WhatsApp pour en recevoir un autre.',
  CODE_DESACTIVE:
    'Ce code a été désactivé. Vérifie les lettres, ou écris-nous sur WhatsApp.',
};

const RAISON_PAR_DEFAUT =
  'Impossible de vérifier ce code pour le moment. Réessaie dans un instant, ou écris-nous sur WhatsApp.';

type EtatCode =
  | { kind: 'vide' }
  | { kind: 'ok'; code: string; label: string; credits: number }
  | { kind: 'ko'; message: string };

export function CodeForm() {
  const [valeur, setValeur] = useState('');
  const [chargement, setChargement] = useState(false);
  const [etat, setEtat] = useState<EtatCode>({ kind: 'vide' });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (chargement) return;

    const v = valeur.trim().toUpperCase();
    if (!v) {
      setEtat({ kind: 'ko', message: 'Entre le code entendu dans la vidéo.' });
      return;
    }

    setChargement(true);
    setEtat({ kind: 'vide' });

    try {
      const res = await fetch('/api/codes/verifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: v }),
      });
      const data = (await res.json()) as VerificationCode;

      if (data.ok) {
        setEtat({
          kind: 'ok',
          code: v,
          label: data.label ?? v,
          credits: data.credits ?? 0,
        });
      } else {
        const raison = data.raison ?? '';
        setEtat({ kind: 'ko', message: RAISONS[raison] ?? RAISON_PAR_DEFAUT });
      }
    } catch {
      setEtat({ kind: 'ko', message: RAISON_PAR_DEFAUT });
    } finally {
      setChargement(false);
    }
  }

  const classeMsg =
    etat.kind === 'ok'
      ? 'codemsg ok'
      : etat.kind === 'ko'
        ? 'codemsg ko'
        : 'codemsg';

  return (
    <>
      <form
        className="codeform"
        id="codeform"
        autoComplete="off"
        onSubmit={onSubmit}
      >
        <input
          type="text"
          id="codein"
          placeholder="Ex : HISTOIRE20"
          aria-label="Code promo"
          maxLength={18}
          value={valeur}
          onChange={(e) => setValeur(e.target.value)}
        />
        <button type="submit" className="btn o" disabled={chargement}>
          {chargement ? 'Vérification…' : 'Activer mes crédits'}
        </button>
      </form>
      <div className={classeMsg} id="codemsg" role="status">
        {etat.kind === 'ok' ? (
          <>
            {'✓ Code ' +
              etat.label +
              ' accepté — ' +
              etat.credits +
              ' crédits t’attendent. Crée ton compte pour les récupérer.'}{' '}
            <a
              href={'/connexion?code=' + encodeURIComponent(etat.code)}
              style={{ textDecoration: 'underline' }}
            >
              Créer mon compte
            </a>
          </>
        ) : etat.kind === 'ko' ? (
          etat.message
        ) : null}
      </div>
    </>
  );
}

/* ------------------------------------------------- conversation WhatsApp */

type WaMessage = { s: 'me' | 'you'; t: string; h: string };

const WA_MESSAGES: ReadonlyArray<WaMessage> = [
  { s: 'you', t: "Bonsoir, c'est combien les mèches brésiliennes 20 pouces ?", h: '20:38' },
  { s: 'me', t: 'Bonsoir Fatou. 12 500 F le lot, livré dans la journée.', h: '20:39' },
  { s: 'you', t: 'Vous avez encore la couleur naturelle ?', h: '20:41' },
  { s: 'me', t: "Oui, il m'en reste quatre. Je vous en garde un jusqu'à ce soir ?", h: '20:41' },
  { s: 'you', t: 'Oui gardez-le. Je paie par mobile money.', h: '20:44' },
  { s: 'me', t: 'Parfait, je vous envoie le lien. Vous payez, je livre demain matin.', h: '20:45' },
  { s: 'you', t: "C'est fait. Merci !", h: '20:52' },
];

type Bulle = { key: number; m: WaMessage };

export function WhatsAppDemo() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [bulles, setBulles] = useState<Bulle[]>([]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let vivant = true;
    let idx = 0;
    let cle = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const push = (): void => {
      if (!vivant) return;

      if (idx >= WA_MESSAGES.length) {
        timer = setTimeout(() => {
          if (!vivant) return;
          setBulles([]);
          idx = 0;
          push();
        }, 4200);
        return;
      }

      const m = WA_MESSAGES[idx];
      idx += 1;
      if (!m) return;

      const k = cle;
      cle += 1;
      setBulles((prev) => [...prev, { key: k, m }].slice(-6));
      timer = setTimeout(push, m.s === 'me' ? 1500 : 1150);
    };

    let demarre = false;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !demarre) {
            demarre = true;
            push();
          }
        });
      },
      { threshold: 0.2 },
    );
    io.observe(node);

    return () => {
      vivant = false;
      if (timer) clearTimeout(timer);
      io.disconnect();
    };
  }, []);

  return (
    <div className="wa-body" id="chat" ref={ref}>
      {bulles.map((b) => (
        <div key={b.key} className={'bub ' + (b.m.s === 'me' ? 'me' : 'you')}>
          {b.m.t}
          <b>{b.m.h}</b>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- solde animé */

export function AnimatedBalance() {
  const balRef = useRef<HTMLSpanElement | null>(null);
  const [solde, setSolde] = useState(0);
  const [largeur, setLargeur] = useState<string | undefined>(undefined);

  useEffect(() => {
    const node = balRef.current;
    if (!node) return;

    let vivant = true;
    let lance = false;
    let raf = 0;
    let t0: number | null = null;

    const step = (t: number): void => {
      if (!vivant) return;
      if (t0 === null) t0 = t;
      const p = Math.min((t - t0) / 1400, 1);
      setSolde(Math.round(340 * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !lance) {
            lance = true;
            setLargeur('68%');
            raf = requestAnimationFrame(step);
          }
        });
      },
      { threshold: 0.35 },
    );
    io.observe(node);

    return () => {
      vivant = false;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  return (
    <div className="wcard rv">
      <div className="wtop"><span>SOLDE DIGIAFRIK</span><span>Aïcha B. · Abidjan</span></div>
      <div className="wbal"><span id="bal" ref={balRef}>{solde}</span> <s>crédits</s></div>
      <div className="wbar"><i id="bar" style={largeur ? { width: largeur } : undefined}></i></div>
      <div className="wtop" style={{ fontSize: "11.5px", fontWeight: "600", opacity: ".66" }}><span>Rechargé le 12 juillet</span><span>N'expire pas</span></div>
      <div className="wlist">
        <div className="wrow"><span>Code HISTOIRE20 <span className="tagfam tagoff">Offert</span></span><b className="pos">+20</b></div>
        <div className="wrow"><span>Livre « Amina et le marché » <span className="tagfam">Famille</span></span><b className="neg">−55</b></div>
        <div className="wrow"><span>Kit Klik — Mèches brésiliennes <span className="tagfam tagbiz">Business</span></span><b className="neg">−12</b></div>
      </div>
      <div className="hcta" style={{ marginTop: "20px" }}><a href="/compte" className="btn o">Recharger</a><a href="/compte" className="btn">Voir l'historique</a></div>
    </div>
  );
}

/* --------------------------------------------------- calculateur crédits */

type Pack = { n: number; l: string; p: number };

const PACKS: ReadonlyArray<Pack> = [
  { n: 150, l: 'Essentielle', p: 7900 },
  { n: 400, l: 'Créateur', p: 17900 },
  { n: 900, l: 'Studio', p: 34900 },
  { n: 2000, l: 'Business', p: 69900 },
];

function recommandation(n: number, cur: Currency): string {
  if (n === 0) return "Commence par tes crédits d'essai, ils sont offerts.";

  let pack: Pack | undefined;
  for (const p of PACKS) {
    if (p.n >= n) {
      pack = p;
      break;
    }
  }

  if (!pack) {
    const dernier = PACKS[PACKS.length - 1];
    const nom = dernier ? dernier.l : '';
    return (
      'Au-delà de la recharge ' + nom + ' : écris-nous, on te fait un pack sur mesure.'
    );
  }

  const mois = Math.floor(pack.n / n);
  return (
    'La recharge ' +
    pack.l +
    ' — ' +
    groupe(pack.n, NNBSP) +
    ' crédits, ' +
    formatMontant(pack.p, cur) +
    (mois > 1 ? ' — te couvre ' + mois + ' mois.' : ' — couvre ton mois.')
  );
}

export function CreditCalculator() {
  const { cur } = useCurrency();
  const [livres, setLivres] = useState(2);
  const [kits, setKits] = useState(4);
  const [visuels, setVisuels] = useState(10);

  const total = kits * 12 + livres * 55 + visuels * 3;
  const reco = useMemo(() => recommandation(total, cur), [total, cur]);

  return (
    <div className="calc rv">
      <h4>Combien il te faut de crédits ?</h4>
      <div className="hint">Bouge les curseurs selon ton mois habituel.</div>
      <div className="slider-row">
        <div className="slabel"><span>Livres MeeraDraw</span><b id="v2">{livres}</b></div>
        <input
          type="range"
          id="s2"
          min={0}
          max={12}
          value={livres}
          onChange={(e) => setLivres(Number(e.target.value))}
          aria-label="Livres MeeraDraw par mois"
        />
      </div>
      <div className="slider-row">
        <div className="slabel"><span>Kits de vente Klik</span><b id="v1">{kits}</b></div>
        <input
          type="range"
          id="s1"
          min={0}
          max={20}
          value={kits}
          onChange={(e) => setKits(Number(e.target.value))}
          aria-label="Kits Klik par mois"
        />
      </div>
      <div className="slider-row">
        <div className="slabel"><span>Visuels produits</span><b id="v3">{visuels}</b></div>
        <input
          type="range"
          id="s3"
          min={0}
          max={60}
          value={visuels}
          onChange={(e) => setVisuels(Number(e.target.value))}
          aria-label="Visuels par mois"
        />
      </div>
      <div className="total">
        <div><div className="n" id="tot">{groupe(total, NNBSP)}</div><div style={{ fontSize: "12.5px", fontWeight: "700", opacity: ".72" }}>crédits par mois</div></div>
        <div className="l" id="reco">{reco}</div>
      </div>
    </div>
  );
}
