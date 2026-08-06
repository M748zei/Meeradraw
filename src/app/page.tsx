import { CodeForm, CreditCalculator, CurrencySwitcher, Price } from '../components/site-client';

/**
 * Page d'accueil — volontairement courte.
 *
 * Le partage des rôles est le suivant, et tout le reste en découle :
 *   Chariow        → la caisse (mobile money, paiement, affiliation, remboursement)
 *   digiafrik.shop → le compte (identité, solde, recharge)
 *   MeeraDraw/Klik → les outils (là où les crédits se consomment)
 *
 * Cette page n'est donc pas une boutique : c'est une porte d'entrée. Elle dit ce
 * qu'est DigiAfrik, montre les deux outils, et envoie soit vers la caisse, soit
 * vers le compte. Les sections vitrine (témoignages, FAQ, démonstrations,
 * statistiques invérifiables) ont été retirées : sur une audience qui vérifie ce
 * qu'on lui raconte, une preuve fabriquée coûte plus cher qu'elle ne rapporte.
 */
export default function Page() {
  return (
    <>
      <nav><div className="wrap nv">
        <a href="/" className="logo">
          <svg className="lmark" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="17" fill="#FF4A18" stroke="#131110" strokeWidth="3" />
            <circle cx="26" cy="14" r="5" fill="#FFC72C" stroke="#131110" strokeWidth="2.4" />
          </svg>DIGIAFRIK
        </a>
        <div className="nl">
          <a href="#outils">Les outils</a>
          <a href="#credits">Crédits</a>
          <a href="#affiliation">Affiliation</a>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <CurrencySwitcher />
          <a href="/connexion" className="btn o sm">Mon compte</a>
        </div>
      </div></nav>

      <header><div className="wrap">
        <div className="hgrid">
          <div>
            <div className="sticker rv">★ Des logiciels IA simples, faits en Afrique</div>
            <h1 className="rv">
              Des images qui nous <span className="hl pk">ressemblent<svg viewBox="0 0 200 20" preserveAspectRatio="none"><path d="M3 13 C50 4, 150 4, 197 11" stroke="#FFC72C" strokeWidth="10" fill="none" strokeLinecap="round" /></svg></span>.<br />
              Des textes qui <span className="hl bl">vendent<svg viewBox="0 0 200 20" preserveAspectRatio="none"><path d="M3 12 C50 20, 150 3, 197 12" stroke="#FFC72C" strokeWidth="10" fill="none" strokeLinecap="round" /></svg></span>.<br />
              <span className="slab">Un seul compte.</span>
            </h1>
            <p className="lede rv">
              Tape « un homme d&rsquo;affaires » dans un outil américain : tu obtiens un
              Blanc dans un bureau de New York. Chez nous, tu obtiens un homme noir à
              Abidjan. <strong>Même compte, même solde de crédits, même téléphone.</strong>
            </p>

            <div className="codecard rv">
              <div className="flash"></div>
              <h3>Tu as un code ? Récupère tes crédits offerts.</h3>
              <p>Entre le code entendu dans la vidéo et tes crédits arrivent tout de suite, avant même de payer quoi que ce soit.</p>
              <CodeForm />
            </div>

            <div className="hcta rv" style={{ marginTop: '22px' }}>
              <a href="/connexion" className="btn lg">Créer mon compte gratuit</a>
              <span className="mini">Sans carte bancaire · 0 F d&rsquo;abonnement</span>
            </div>
          </div>

          <div className="doors rv" id="outils">
            <a href="https://hymamcey.mychariow.shop/prd_d2ik58za" className="door fam">
              <div className="top">
                <svg className="ic" viewBox="0 0 48 48" fill="none">
                  <rect x="5" y="9" width="38" height="30" rx="5" fill="#FFC72C" stroke="#131110" strokeWidth="3" />
                  <circle cx="17" cy="20" r="4" fill="#131110" />
                  <path d="M6 34 L19 23 L28 31 L35 26 L42 33" stroke="#131110" strokeWidth="3" fill="none" strokeLinejoin="round" />
                </svg>
                <div><h3>MeeraDraw</h3><div className="sub">Le Midjourney africain</div></div>
              </div>
              <p>Tu décris une scène en une phrase, tu choisis un style, tu reçois ton image. Les visages, les tissus, les rues et la lumière sont ceux d&rsquo;ici — par défaut, sans avoir à le demander.</p>
              <ul><li>30 styles</li><li>Texte incrusté</li><li>9:16 · 1:1 · 16:9</li></ul>
              <div className="pricebar" style={{ marginTop: 14 }}>
                <Price className="p" xof={4900} />
                <Price className="was" xof={13900} />
                <span className="go" style={{ marginLeft: 'auto' }}>Ouvrir →</span>
              </div>
            </a>

            <a href="https://hymamcey.mychariow.shop/prd_fl4at9rv" className="door biz">
              <div className="top">
                <svg className="ic" viewBox="0 0 48 48" fill="none">
                  <rect x="6" y="14" width="36" height="26" rx="5" fill="#FFC72C" stroke="#131110" strokeWidth="3" />
                  <path d="M17 14 V10 a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v4" stroke="#131110" strokeWidth="3" fill="none" />
                  <path d="M6 25 h36" stroke="#131110" strokeWidth="3" />
                </svg>
                <div><h3>Klik</h3><div className="sub">Tes textes de vente, écrits</div></div>
              </div>
              <p>Ta page de vente, tes messages WhatsApp, ton kit Facebook, tes scripts TikTok — écrits depuis ton vrai produit. Klik n&rsquo;invente ni un prix, ni une garantie, ni une fonction.</p>
              <ul><li>WhatsApp</li><li>Facebook</li><li>TikTok</li></ul>
              <div className="pricebar" style={{ marginTop: 14 }}>
                <Price className="p" xof={13900} />
                <Price className="was" xof={37900} />
                <span className="go" style={{ marginLeft: 'auto' }}>Ouvrir →</span>
              </div>
            </a>
          </div>
        </div>
      </div></header>

      <div className="band"><div className="band-t">
        <div className="band-i"><span>ORANGE MONEY</span><i>✦</i><span>WAVE</span><i>✦</i><span>MTN MOMO</span><i>✦</i><span>MOOV MONEY</span><i>✦</i><span>M-PESA</span><i>✦</i><span>AIRTEL MONEY</span><i>✦</i><span>CARTE BANCAIRE</span><i>✦</i></div>
        <div className="band-i"><span>ORANGE MONEY</span><i>✦</i><span>WAVE</span><i>✦</i><span>MTN MOMO</span><i>✦</i><span>MOOV MONEY</span><i>✦</i><span>M-PESA</span><i>✦</i><span>AIRTEL MONEY</span><i>✦</i><span>CARTE BANCAIRE</span><i>✦</i></div>
      </div></div>

      <section className="sec blue" id="credits"><div className="wrap">
        <div className="sh rv">
          <span className="kick">Le portefeuille commun</span>
          <h2>Une image lundi.<br />Une page de vente <em>jeudi</em>.<br />Le même solde.</h2>
          <p>Tu paies une fois, tes crédits arrivent sur ton compte, et ils servent sur tous les outils. Ils n&rsquo;expirent pas. Si une création échoue, ils te sont rendus automatiquement.</p>
        </div>
        <CreditCalculator />
      </div></section>

      <section className="sec ink" id="affiliation"><div className="wrap">
        <div className="sh rv">
          <span className="kick">Programme affilié</span>
          <h2>Gagne <em>40 %</em> sans avoir de produit à toi.</h2>
          <p>Tu as une page, une chaîne, un groupe WhatsApp ? Tu partages ton lien, Chariow suit la vente et te paie la commission sur ton Mobile Money. Rien à gérer, rien à livrer.</p>
        </div>
        <div className="aff rv">
          <div className="pay"><span>Un accès Klik vendu</span><Price as="b" xof={5560} plus /></div>
          <div className="pay"><span>Un accès MeeraDraw vendu</span><Price as="b" xof={1960} plus /></div>
        </div>
        <div className="hcta rv" style={{ marginTop: '26px' }}>
          <a href="https://hymamcey.mychariow.shop/affiliation" className="btn o">Devenir affilié</a>
        </div>
      </div></section>

      <section className="final">
        <div className="wrap">
          <h2 className="rv">Ce soir, tu crées<br />quelque chose.</h2>
          <div className="hcta rv" style={{ justifyContent: 'center' }}>
            <a href="/connexion" className="btn lg">Créer mon compte gratuit</a>
            <a href="https://whatsapp.com/channel/0029Vb8utpJ3GJOs2Qgb3h3P" className="btn y" target="_blank" rel="noopener noreferrer">Le canal WhatsApp</a>
          </div>
        </div>
      </section>
    </>
  );
}
