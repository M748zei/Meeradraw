# PROJECT_LOG — Meeradraw (projet CHARIOW)

Journal chronologique du projet. Entrée la plus récente en haut.

---

## 2026-07-21 (suite 2) — 🚀 MISE EN PRODUCTION sur meeradraw.digiafrik.shop

### Réalisé
1. **Build local vérifié** (0 erreur, 28 routes + middleware) ; `PROJECT_LOG.md`
   commité et poussé (`547c0f0`).
2. **Vercel CLI** mise à jour (50.38.3 → 56.4.1), compte `digiafrik` déjà
   connecté (le blocage MCP 403 ne concernait pas la CLI).
3. **Projet Vercel `meeradraw` créé et lié** (scope
   `mabroukzeidane04-5342s-projects`, même scope que Klik) + **repo GitHub
   connecté** → déploiements auto à chaque push sur `main`.
   Note : `vercel link` a ajouté `VERCEL_OIDC_TOKEN` à `.env.local` (normal).
4. **22 variables d'env de production** poussées via script (valeurs jamais
   affichées) : Firebase client + Admin, Groq, FAL, Chariow API, et surcharges
   `MOCK_AI=false`, `CHARIOW_WEBHOOK_SECRET`, `ADMIN_EMAILS`,
   `NEXT_PUBLIC_APP_URL=https://meeradraw.digiafrik.shop` (choisi d'emblée pour
   éviter les redéploiements). Exclues comme prévu : `STRIPE_*`,
   `CHARIOW_PRODUCT_ID/SLUG`, `NEXT_PUBLIC_CHARIOW_STORE_URL`
   (`OPENAI_API_KEY` vide → ignorée).
5. **Déploiement production** : `vercel --prod` → READY.
6. **Domaine `meeradraw.digiafrik.shop`** : ajouté au projet ; comme
   `digiafrik.shop` est enregistré chez Vercel (nameservers Vercel, même
   compte), le DNS a été configuré **automatiquement** — aucun enregistrement
   manuel. Domaine vérifié et actif (HTTPS OK).
7. **Vérifications en prod** :
   - Landing 200 (titre + images OK), `/login` & `/signup` 200,
     `/dashboard` & `/library` → 307 vers `/login?next=…`, API sans session → 401.
   - **Test E2E auth réel** (compte jetable) : signup Firebase → cookie
     `__session` créé → profil Firestore avec **30 crédits de bienvenue** →
     gate licence Chariow actif (`valid:false`, message d'activation).
     Compte test supprimé (Auth + doc Firestore + ledger).

### Reste à faire (manuel)
- [ ] Firebase Console → Authentication → Settings → **Authorized domains** :
      ajouter `meeradraw.digiafrik.shop` (requis pour la connexion Google ;
      l'email/password fonctionne déjà).
- [ ] Test génération complète (idée → livre → PDF) avec un email
      `ADMIN_EMAILS` (nécessite le mot de passe du compte admin).
- [ ] Produit licence Meeradraw sur DigiAfrik → `CHARIOW_PRODUCT_ID`,
      `NEXT_PUBLIC_CHARIOW_STORE_URL` + Pulse webhook
      `https://meeradraw.digiafrik.shop/api/webhooks/chariow?token=<CHARIOW_WEBHOOK_SECRET>`.
- [ ] Stripe (crédits payants) : `STRIPE_*` quand prêt.
- [ ] Déployer règles Firestore/Storage + index (`firebase deploy --only
      firestore:rules,firestore:indexes,storage`).

---

## 2026-07-21 (suite) — Refonte design/UX, GitHub, préparation déploiement

### Réalisé
1. **Refonte design/UX** :
   - **Landing page** entièrement refaite (`app/page.tsx`) : hero animé avec de
     vraies pages de coloriage (éventail + galerie), sections « Pourquoi c'est
     différent », « Comment ça marche », parcours d'accès Chariow, CTA final.
     Nouveaux composants `components/landing/{showcase,gallery,reveal}.tsx`
     (Framer Motion). Validée visuellement (screenshots desktop + mobile).
   - **Dashboard** (`app/(app)/dashboard/page.tsx`) : stats avec icônes, cartes
     livres avec vraie cover + badge de statut coloré, tri par récence.
   - **Page licence** (`app/(app)/license/page.tsx`) : icônes, état « actif »
     valorisé, note de réassurance.
   - Nouveau `components/books/status-badge.tsx`.
2. **Images optimisées** : les rendus de test PNG (~20 Mo) convertis en JPEG
   légers (~50 KB, dossier `public/_gentest7/*.jpg`) pour la landing. Logo
   optimisé. `.gitignore` mis à jour pour exclure les assets de test lourds
   (`_phase2ab/`, `_gentest7/*.png`) → dépôt léger.
3. **GitHub** : code poussé sur **https://github.com/M748zei/Meeradraw** (privé).
   Push réussi (234 objets, 1.12 Mo, branche `main`). Secrets (`.env.local`)
   bien exclus.
4. **Déploiement** : le connecteur Vercel MCP ne peut pas créer de projet
   (403 forbidden — permissions). Décision : déploiement via **import GitHub**
   dans l'UI Vercel (+ déploiements auto à chaque push). Guide + variables d'env
   de production préparés (webhook secret généré, ADMIN_EMAILS complété).

### État build
TypeScript **0 erreur**, ESLint **0 erreur** (3 warnings React acceptables),
`next build` **OK (28 routes)**.

### Prochaines étapes
- [ ] Terminer l'import Vercel (M748zei/Meeradraw) + coller les variables d'env.
- [ ] Après 1er déploiement : mettre à jour `NEXT_PUBLIC_APP_URL` avec l'URL réelle + redéployer.
- [ ] Créer le produit licence Meeradraw sur DigiAfrik → renseigner `CHARIOW_PRODUCT_ID`.
- [ ] Configurer le Pulse webhook Chariow → `{APP_URL}/api/webhooks/chariow?token=<CHARIOW_WEBHOOK_SECRET>`.
- [ ] (Option) domaine `meeradraw.digiafrik.shop`.

---

## 2026-07-21 — Audit complet + correction des bugs critiques (crédits, licences, webhooks)

### Contexte
Reprise du SaaS **Meeradraw** (générateur de livres de coloriage IA, Next.js 16 +
Firebase, vendu via Chariow / boutique DigiAfrik). Objectif de la session :
corriger les bugs, améliorer le design/UX, ajouter des fonctionnalités, puis
mettre en ligne sous le domaine `digiafrik.shop` (comme Klik → `klik.digiafrik.shop`).

### Réalisé
1. **Audit complet du code** (architecture, modèle de données, bugs) via analyse
   approfondie + revue adversariale.
   - État build : TypeScript **0 erreur**, `next build` **OK (28 routes)**.
     (Le seul échec de build en sandbox venait du blocage réseau Google Fonts,
     pas du code — résolu en prod/Vercel.)

2. **Correction des bugs CRITIQUES de facturation (crédits)** — modèle
   **réservation atomique + remboursement au prorata** :
   - `CreditService` réécrit : toutes les mutations de solde passent par
     `runTransaction` (atomique, plus de lost-update). Nouvelles méthodes
     `reserve()` / `refund()`, plus idempotence via `reference_id`
     (tuple `(operation, reference_id)`).
   - `generation/start` : réserve désormais le coût **avant** de lancer la
     génération (plus de génération gratuite si crash / générations parallèles).
   - `generation-orchestrator` : supprimé le débit final ; rembourse maintenant
     les pages non livrées (partiel), tout le coût (échec total ou crash).
     Le remboursement se base sur `book.page_count` (couvre aussi le cas où
     l'IA renvoie moins de pages que demandé).
   - `generation/retry` : facture par page régénérée (réservation atomique),
     rembourse les pages encore en échec, avec garde `try/finally` anti-strand.
   - `dev/gen-test` : réserve désormais aussi (sinon le remboursement créait des
     crédits gratuits) ; secret déplacé en env `DEV_GENTEST_SECRET` (plus de
     secret en dur) ; email admin hardcodé erroné retiré.

3. **Stripe** : webhook rendu **idempotent** sur `event.id` (plus de
   double/triple crédit sur retry Stripe).

4. **Chariow (licences)** — mise en conformité avec l'API réelle (docs + test live) :
   - `assertProductMatch` : matche sur `product.id` **uniquement** (le
     `product.slug` n'existe pas dans l'API Chariow) + **fail-closed** si l'id
     attendu est configuré mais absent de la licence.
   - `product.id` typé `string | number` (l'endpoint activate renvoie un id
     numérique), comparaison via `String()`.
   - Webhook Chariow réécrit : lit la **vraie** structure de payload
     (`payload.license` au top-level, pas `payload.data.license`), mappe les
     **vrais** noms d'événements (`license.issued/activated/expired/revoked`,
     `successful.sale`, etc.), idempotent (enregistrement par id déterministe),
     vérification de secret à **temps constant** + **fail-closed en production**.

5. **Lint / robustesse** :
   - Règles React trop strictes de Next 16 (`set-state-in-effect`,
     `immutability`, `refs`) passées en `warn` (code idiomatique, ne bloque plus
     le déploiement).
   - Tri no-op du dashboard remplacé par un vrai tri par récence.
   - `window.location.href = …` → `window.location.assign(…)`.
   - Guard NaN sur les env numériques de l'orchestrateur (`PAGE_GEN_CONCURRENCY`,
     `SHEET_MAX_ATTEMPTS`).

### Fichiers modifiés
- `services/credit-service.ts` (réécrit — transactions atomiques + reserve/refund/idempotence)
- `config/credits.ts` (`perPageCost`, `refundForFailedPages`)
- `services/generation-orchestrator.ts` (réservation/remboursement, guard NaN)
- `app/api/generation/start/route.ts` (réservation up-front)
- `app/api/generation/retry/route.ts` (facturation par page + try/finally)
- `app/api/dev/gen-test/route.ts` (réservation + secret env + email admin)
- `app/api/webhooks/stripe/route.ts` (idempotence)
- `app/api/webhooks/chariow/route.ts` (réécrit — secret constant-time, fail-closed)
- `services/license-service.ts` (product.id fail-closed, webhook payload réel, idempotence)
- `lib/chariow/client.ts` (product.id string|number)
- `eslint.config.mjs` (règles React en warn)
- `app/(app)/dashboard/page.tsx` (tri par récence)
- `app/(app)/credits/page.tsx` (location.assign)
- `app/(app)/universes/[id]/books/new/page.tsx` (directive eslint obsolète retirée)

### Décisions importantes
- **Facturation crédits** = réservation atomique puis remboursement de la part
  non produite (choix validé : le plus juste pour le créateur et le client).
- **Hébergement cible** = sous le groupe de domaine `digiafrik.shop`
  (ex. `meeradraw.digiafrik.shop` ou `app.digiafrik.shop`).
- **Vérification** : logique de crédits validée par 9 tests unitaires purs +
  revue adversariale (3 findings supplémentaires corrigés).

### Prochaines étapes
- [ ] Amélioration design / UX (landing, dashboard, studio de génération).
- [ ] Configurer les variables d'env de production (Firebase Admin, FAL, Groq,
      Chariow `CHARIOW_PRODUCT_ID=prd_...`, `CHARIOW_API_KEY`, webhook secret).
- [ ] Déploiement (Vercel recommandé) + sous-domaine `*.digiafrik.shop`.
- [ ] Configurer le Pulse webhook Chariow → `{APP_URL}/api/webhooks/chariow?token=<secret>`.
- [ ] Créer/relier le produit **licence** Meeradraw sur la boutique DigiAfrik.
- [ ] Déployer les règles Firestore/Storage + index composites.
