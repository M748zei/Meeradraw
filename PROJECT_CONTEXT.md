# PROJECT_CONTEXT — Meeradraw (projet CHARIOW)

Mémoire technique du projet. À lire en premier pour reprendre le travail.

Dernière mise à jour : 2026-07-21

---

## Vision

**Meeradraw** est une plateforme SaaS qui crée des **livres de coloriage
professionnels** (niveau librairie / Amazon KDP) à partir d'une simple idée,
grâce à l'IA. Cible : créateurs / parents / enseignants, avec une attention
particulière au marché africain (via la boutique DigiAfrik).

## Modèle commercial (IMPORTANT)

Meeradraw **n'est pas vendu directement** : il est distribué via **Chariow**
(marketplace, boutique **DigiAfrik**, comme le produit Klik).
- **Chariow = source de vérité** des achats / licences (vente, paiement,
  commande, e-mail d'accès, licence, remboursement, renouvellement).
- **Meeradraw = le logiciel** consommé après achat (comptes, univers, livres,
  générations IA, crédits d'usage internes, PDF).
- Les **crédits Stripe** internes mesurent l'**usage** du studio — ils ne
  remplacent pas l'achat du produit sur Chariow.
- Détails : `docs/chariow-licensing.md`.

## Objectifs de la session en cours (2026-07-21)
Corriger bugs → améliorer design/UX → ajouter fonctionnalités → mettre en ligne
sous le domaine `digiafrik.shop`.

## Stack technique

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript 5**
- **Tailwind CSS 4** + Framer Motion
- **Firebase** : Auth (email/password + Google), Firestore, Storage
  - Project ID : `bookstudioai-8eadb`
- **IA texte** : Groq (OpenAI-compatible) ou OpenAI, sinon mock (`MOCK_AI=true`)
- **IA image** : fal.ai (flux/dev, Ideogram, Kontext), sinon mock
- **Paiements** : Stripe (achat de crédits d'usage)
- **PDF** : pdf-lib
- **Licences** : Chariow API (`api.chariow.com/v1`)

## Architecture

```
UI (app/) → API routes (app/api/) → Services (services/) → Firebase / IA / Chariow
```

- **Auth gate** : `lib/api-auth.ts#requireUser()` (cookie `__session`, crée le
  profil + 30 crédits de bienvenue au 1er accès).
- **Services** : injectés avec le handle Firestore Admin. Chaque route est mince
  (`requireUser` → zod → service → `apiSuccess`/`apiError`).
- **Erreurs** : `lib/errors.ts` (`AppError` + messages FR localisés).
- **Providers IA** : `services/ai/index.ts` (factory mock/réel selon env).

### Pipeline de génération (services/generation-orchestrator.ts)
```
idée → buildResearchBrief → generateStoryPlan (concept+bible+storyboard)
     → normalizeStoryPlan → model sheet (fal) → cover → pages (fal) → PDF
```
Déclenché par `POST /api/generation/start` (via `after()`), suivi par
`GET /api/generation/[id]`. Régénération : `POST /api/generation/retry`.

### Système de crédits (réservation + remboursement) — depuis 2026-07-21
- **Atomique** : toutes les mutations de solde via `runTransaction`.
- **Idempotent** : `reference_id` (tuple `(operation, reference_id)`).
- `generation/start` **réserve** le coût complet avant de lancer.
- L'orchestrateur **rembourse** les pages non livrées (base = `book.page_count`)
  en fin de run, ou tout le coût en cas d'échec total / crash.
- `generation/retry` réserve par page puis rembourse les échecs (try/finally).
- Coûts : `config/credits.ts` (`CREDIT_COSTS`, `estimateBookCost`,
  `perPageCost`, `refundForFailedPages`).

### Licences Chariow (services/license-service.ts)
- **Seul module** qui parle à Chariow pour la logique métier.
- `requireActiveLicense` (gate génération), `activateForUser`, `getStatus`,
  `handleWebhookEvent`.
- Matching produit sur **`product.id`** (pas de slug), **fail-closed**.
- Webhook : payload réel `payload.license` (top-level), événements réels
  (`license.issued/activated/expired/revoked`, `successful.sale`…), idempotent,
  secret vérifié à temps constant, fail-closed en prod.
- Admins (`ADMIN_EMAILS`) : accès complet sans licence.

## Modèle de données (Firestore) — types/database.ts
- `users/{uid}` (Profile + `chariow_license`) · sous-collection `credit_ledger`
- `universes/{id}` · sous-collection `characters`
- `books/{id}` · sous-collection `pages`
- `generations/{id}`, `prompts/{id}`, `licenses/{id}`, `chariow_events/{id}`,
  `transactions/{id}`

⚠️ Les interfaces TS `Character` / `Page` ne reflètent pas encore 100 % des
champs réellement écrits (`id_key`, `negative_prompt`, etc.) — à aligner.

## Conventions de code
- Routes API minces, validation zod, services injectés avec `Firestore`.
- Erreurs via `AppError` + `apiError`/`apiSuccess`.
- Messages utilisateur en **français**.
- Idempotence des opérations d'argent via `reference_id`.
- Mutations de solde **toujours** via `CreditService` (jamais d'écriture directe
  de `credits`).
- Ne jamais laisser un livre en `generating` sans remboursement en cas d'échec.

## Configuration (.env.local / prod)
Voir `.env.example`. Clés importantes en prod :
- Firebase client + **Firebase Admin** (`FIREBASE_CLIENT_EMAIL`,
  `FIREBASE_PRIVATE_KEY`).
- `GROQ_API_KEY` (ou `OPENAI_API_KEY`), `FAL_KEY`, `MOCK_AI=false`.
- **Chariow** : `CHARIOW_API_KEY`, `CHARIOW_PRODUCT_ID=prd_...` (id du produit
  licence Meeradraw sur DigiAfrik), `CHARIOW_WEBHOOK_SECRET`,
  `NEXT_PUBLIC_CHARIOW_STORE_URL`.
- Stripe (si crédits payants) : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- `ADMIN_EMAILS` (accès sans licence).
- `DEV_GENTEST_SECRET` (dev uniquement, pour la route de test).
- `NEXT_PUBLIC_APP_URL` (URL de prod).

## Reprise immédiate du travail
1. Lire ce fichier + `PROJECT_LOG.md` (dernière entrée) + `ROADMAP.md`.
2. Code source de référence : le dossier sur la machine
   `~/Desktop/colorbookai` (source de vérité ; pas de remote git configuré).
3. Build local : `npm install && npm run dev`. Prod : `npm run build`.
4. Prochaine étape : voir « En cours » / « À faire » dans `ROADMAP.md`.
