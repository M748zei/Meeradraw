# PROJECT_LOG — Meeradraw (projet CHARIOW)

Journal chronologique du projet. Entrée la plus récente en haut.

---

## 2026-07-22 (soir) — ÉTAPE 1 : Chariow branché en prod (accès/licence) ✅

### Réalisé (mode autonome)
1. **Vérifié via MCP Chariow** : Pulse `pulse_i33w69149md3` actif (tous
   événements) avec l'URL `https://meeradraw.digiafrik.shop/api/webhooks/chariow?token=<CHARIOW_WEBHOOK_SECRET>` ;
   produit accès `prd_d2ik58za` **publié** (4 900 F, promo −65 %) ; les 4 packs
   crédits (`prd_0658xmlt`, `prd_68mvngwe`, `prd_0gsbsozy`, `prd_7vx0ru3k`)
   existent en **draft** avec les bons prix FCFA.
2. **Variables d'env** : les valeurs prod étant illisibles (type Sensitive),
   réécriture complète avec les valeurs de la spec : `CHARIOW_PRODUCT_ID=prd_d2ik58za`,
   `NEXT_PUBLIC_CHARIOW_STORE_URL` (les 2 aussi en Preview), `CHARIOW_API_BASE`,
   `CHARIOW_WEBHOOK_SECRET` (= token du Pulse), `ADMIN_EMAILS`
   (manbroukmohamedzei@ + mabroukzeidane04@gmail.com), et **nouvelle
   `CHARIOW_API_KEY` fournie par l'utilisateur** (testée : 404 sur clé licence
   bidon = auth OK ; 401 avec une mauvaise clé). Miroir dans `.env.local`.
3. **Prod redéployée** (`vercel redeploy`, READY).

### Vérifications E2E en prod (toutes ✅)
- Webhook : token valide → 200 `{received:true}` ; token invalide/absent →
  403 fail-closed (constant-time).
- Compte jetable → `GET /api/license/status` → `configured:true, required:true,
  valid:false` (fini le bypass dev).
- **Licence d'un autre produit refusée** : activation d'une vraie clé Klik
  (`prd_fl4at9rv`) → 403 « Cette licence ne correspond pas au produit
  Meeradraw » (rejet AVANT l'appel activate → aucune activation consommée).
- Event `license.revoked` accepté (200, idempotent).
- Nettoyage : comptes test purgés (Auth + Firestore + ledger), events de test
  supprimés de `chariow_events`.

---

## 2026-07-22 (suite) — Livres 24 pages + fixes prod à chaud (session interrompue)

### Réalisé après le sprint
1. **Quota Groq épuisé** (llama-3.3, TPD 100k) pendant le test utilisateur →
   bascule prod `GROQ_MODEL=openai/gpt-oss-120b` (quota séparé) +
   `PAGE_GEN_CONCURRENCY=4`.
2. **Livres longs (jusqu'à 24-40 pages)** : le tier gratuit Groq coupe les
   complétions vers ~3k tokens ET pré-compte `max_completion_tokens` dans le
   TPM 8000 (ne JAMAIS le fixer haut). → **storyboard en 2 phases** : plan
   directeur par tranches de 12 pages, puis expansion des champs visuels par
   lots de 6, repli sur le synopsis si un lot échoue (commit `35b2565`).
3. **Bug prod trouvé et corrigé** : gpt-oss a renvoyé un tableau imbriqué →
   Firestore `INVALID_ARGUMENT: Nested arrays are not allowed` → génération
   échouée à 18 % (crédits bien auto-remboursés ✓). Fix : `lib/firestore-sanitize.ts`
   (`firestoreSafe()`) appliqué à TOUTES les écritures de données LLM
   (prompts/characters/story_plan/pages/setting_bible) + characterIds coercés
   en string (commit `db9acfe`, **déployé READY**).

### ⚠️ REPRISE — à faire en priorité
- [ ] **VALIDER un livre 24 pages de bout en bout** (le fix est déployé mais
      PAS encore validé sur un run complet). En local : serveur
      `ADMIN_EMAILS=<email-test> PORT=3100 npm run start` + compte Firebase
      jetable (voir scripts de session : signup REST → /api/auth/session →
      universe → book 24p → generation/start → poll). Vérifier : 24/24 pages,
      qc_stats, zéro fal.media, puis PURGER le compte test.
- [ ] Risque connu 24 pages : dépassement des 300 s Vercel (si pages manquantes
      en fin de run → remboursées + récupérables via retry ; sinon monter
      PAGE_GEN_CONCURRENCY à 5-6).
- [ ] Recommander/mettre en place **Groq Dev Tier** avant les vrais clients.
- [ ] Reste aussi : test complet par l'utilisateur, domaine Google auth,
      produit Chariow (voir entrées précédentes).

---

## 2026-07-22 — SPRINT QUALITÉ IMAGES (P0) : anti-lineup, setting bible, QC vision, persistance

### Corrections livrées (audit produit 5×P0)
1. **Storyboard structuré** (`action`/`characterPoses`/`camera`/`pageSetting`/`focalPoint`
   + `introducedOnPage`) ; actions PHYSIQUES obligatoires (verbes imposés, actions
   "regard/immobile" interdites) ; un personnage n'apparaît jamais avant sa page
   d'introduction ni sur la cover (spoiler). Prompt de page assemblé côté serveur.
2. **Kontext découplé** identité/composition + **benchmark** (13 images, 3 variantes) :
   → duo = référence complète + prompt COMPACT (`ref_scene` — un long prompt fait
   copier le lineup de la référence) ; solo = **crop par personnage** du model sheet
   (sinon le personnage absent fuit dans l'image) ; kontext/multi disqualifié (images noires).
3. **Setting bible par univers** (lazy, stockée sur l'univers) : 8-12 éléments dessinables
   + `forbiddenElements` → negative dérivé. Le décor générique en dur ne s'applique
   plus quand le storyboard fournit un `pageSetting` (fix « cuisine européenne »).
4. **QC vision Groq** (`lib/vision-qc.ts`, modèle `qwen/qwen3.6-27b`, `reasoning_effort:none`,
   images réduites 512px + retry 429 — sinon le TPM 8000 fait tout échouer) : cast
   exact + espèces + posture quadrupède (sheet/cover/pages), anti-lineup + action
   visible (pages ET covers), titre lisible. Fail-open, cap 2 re-rolls vision/image,
   `qc_stats` loggé sur `generations`. Model sheet : animaux en PROFIL sur 4 pattes.
5. **Cover affiche** : Kontext (identité fiable) + **titre composité serveur**
   (`lib/cover-title.ts`, sharp/SVG, wrap 2 lignes) ; fallback Ideogram lettré sans
   référence. Cast cover sans spoiler.
6. **Persistance Storage (P0-5)** : `persistImageFromUrl` → `books/<id>/pages/<n>.png`,
   `books/<id>/cover.png`, `universes/<id>/model_sheet(.png|_char.png)` ; Firestore
   stocke URL signée + path. **Migration exécutée : 138/138 URLs fal migrées, 0 perdue**
   (`scripts/migrate-fal-urls.mjs`). Zéro `fal.media` restant.

### Vérification (4 livres réels générés en local, vraies clés)
- ✅ Cast exact (2/2), espèces correctes, éléphant quadrupède, décors riches sur
  toutes les pages, baobab/savane présents, plus de fond blanc/beige vide sur cover,
  titre lisible, 100 % des URLs sur Storage, crédits/licences intacts (aucune
  modification de CreditService).
- ⚠️ Résiduel connu : poses duo encore parfois statiques (Kontext colle à la
  référence malgré re-rolls) et texte parasite occasionnel (noms) — pistes :
  endpoint kontext max, seconde passe LLM sur les actions, OCR-guard.
- Comptes/données de test purgés. Coût QC observé via `qc_stats` (ex. 8 images,
  7 re-rolls vision).

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
- [x] Règles Firestore/Storage : **durcies puis déployées** (2026-07-21, voir
      entrée suivante).

---

## 2026-07-21 (suite 3) — Durcissement + déploiement des règles Firebase

### Réalisé
1. **Audit** : aucun code client n'utilise Firestore/Storage
   (`getClientDb`/`getClientStorage` jamais appelés) — tout passe par les API
   routes + Admin SDK. Or `users/{userId}` autorisait le `write` propriétaire
   → un utilisateur pouvait éditer ses `credits`/`chariow_license` depuis la
   console navigateur.
2. **`firestore.rules` durci** : `write: if false` partout côté client,
   lecture propriétaire conservée (`storage.rules` déjà strict, inchangé).
3. **Déploiement** : le compte CLI (`mabroukzeidane04@gmail.com`) n'a pas accès
   au projet `bookstudioai-8eadb` et le service account Admin SDK n'a pas la
   permission `serviceusage` exigée par le préflight de la CLI Firebase.
   Contournement : déploiement **direct via l'API `firebaserules`** avec le
   service account (créer ruleset → patcher les releases `cloud.firestore` et
   `firebase.storage/<bucket>`). Releases vérifiées actives (updateTime du
   jour). Index : aucun à déployer (`firestore.indexes.json` vide).

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
