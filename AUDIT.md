# AUDIT — Meeradraw (2026-07-22, étape 4)

Audit complet mené par 3 passes parallèles (correctness/fiabilité, sécurité,
perf/data/UX), findings vérifiés un par un dans le code avant action.
Statut : ✅ corrigé (dans cette étape) · 📋 reco (laissé au user / plus tard) ·
❌ rejeté (finding invalide après vérification, justification incluse).

## P0

| Statut | Sujet | Détail |
|---|---|---|
| ✅ | **Reaper générations bloquées** | Aucun mécanisme ne rattrapait un run tué (timeout Vercel 300 s, crash) : livre bloqué en `generating`, crédits réservés jamais remboursés. → `services/generation-reaper.ts` : (1) auto-guérison sur le polling `GET /api/generation/[id]` (le cas courant — l'utilisateur regarde sa barre de progression), (2) cron quotidien `GET /api/cron/reap-generations` (vercel.json, `CRON_SECRET` posé en prod, fail-closed). Fail + refund transactionnel, **même reference `gen:<id>:refund` que l'orchestrateur** → jamais de double remboursement. Staleness re-vérifiée en transaction (pas de course avec un run qui finit). |
| ✅ | **Types désalignés sur Firestore** | `types/database.ts` ignorait ~20 champs réellement écrits (`Character.id_key/age_band/…`, `Page.ref_scene/camera/page_setting/focal_point/illustration_path/negative_prompt`, `Book.cover_image_path`, `Generation.qc_stats/trial_counted`, `Universe.setting_bible/model_sheet_*`, `Profile.phone/free_trials_*`). → tous ajoutés. |
| ✅ | **N+1 writes Firestore dans la génération** | 1 write par personnage + 1 par page (jusqu'à 45 round-trips séquentiels) → 2 `db.batch()` (`generation-orchestrator.ts`). |

## P1

| Statut | Sujet | Détail |
|---|---|---|
| ✅ | **Aucun rate limiting** | Routes coûteuses (enrich-idea → LLM, checkout → API Chariow, generation/start, auth/session) appelables en boucle. → `lib/rate-limit.ts` (fenêtre glissante en mémoire, par instance — freine les boucles d'abus sans dépendance Redis) : enrich 20/min/user, checkout 10/min/user, start 10/min/user, session 15/min/IP. 📋 Si le trafic devient multi-instance intensif : passer à @upstash/ratelimit. |
| ✅ | **`updateGeneration` non protégé** | Une erreur Firestore transitoire sur une écriture de *progression* tuait tout le run (images déjà payées perdues). → try/catch + log ; le reaper couvre le pire cas. |
| ✅ | **PDF : texte non noir** | Titres/sous-titres/histoires en bleu nuit (`rgb(0.12,0.2,0.35)`) → noir pur `rgb(0,0,0)` (qualité impression). Numéro de page reste gris discret. |
| ✅ | **Warnings lint** | 3 warnings (img dashboard, setState-in-effect ×2) → 0 erreur / 0 warning. |
| ❌ | «Retry accessible aux essais gratuits» | Faux : `generation/retry` appelle `requireActiveLicense` en ligne 26 → un compte essai (sans accès) reçoit 403 avant toute réservation. Comportement voulu : la régénération de pages est réservée aux comptes avec accès. |
| 📋 | **Pagination dashboard/library** | Les listes lisent tous les docs du user puis trient/`slice` en mémoire. Un `.limit()` serveur exige un index composite `(user_id, created_at desc)` (firestore.indexes.json vide, déploiement d'index = action infra séparée). Volume actuel minuscule → reporté, avec plan : déployer l'index, puis `orderBy+limit` + « Charger plus ». |

## P2

| Statut | Sujet | Détail |
|---|---|---|
| ✅ | **SSRF `persistImageFromUrl`** | `fetch(url)` sans contrôle → whitelist d'hôtes (fal.media, *.fal.media, storage.googleapis.com, firebasestorage.googleapis.com, placehold.co), fail-open inchangé. |
| ✅ | **Cache TTL licence** | `last_validated_at` écrit mais jamais lu → `requireActiveLicense` saute l'appel Chariow si l'accès actif a été validé il y a < 10 min (`LICENSE_CACHE_TTL_MS`). Les révocations restent immédiates : le webhook met `is_active:false`, ce qui désarme le fast-path. |
| ✅ | **Emails en casse mélangée** | Le matching des ventes Chariow est une égalité stricte sur `users.email` → `buildNewProfile` normalise désormais en minuscules (le claim au login couvrait déjà le cas, mais avec délai). |
| ✅ | **Code mort** | `services/ai/prompt-engine.ts` (shim déprécié, 0 import) et `components/landing/showcase.tsx` (remplacé par le hero GSAP) supprimés. Stripe déjà retiré à l'étape 2. `dev/gen-test` conservé : gated (désactivé en prod + `DEV_GENTEST_SECRET`). |
| ✅ | **`<img>` non optimisés** | 6 occurrences (dashboard ×2, library, books/[id] ×2, generate, universes/[id]) → `next/image` (WebP auto + lazy, cible 3G). |
| ✅ | **404 + redirects** | `app/not-found.tsx` brandée ; redirects `/create→/universes/new`, `/studio→/dashboard`, `/profil→/profile`, `/acces→/license`. |
| ❌ | «References de refund distinctes partial/crash» | Rejeté : des references distinctes permettraient un **sur-remboursement** (partial 2 cr + crash 30 cr = 32 remboursés pour 30 réservés = minage). La reference unique fait exactement l'inverse : le premier remboursement gagne, l'autre est no-op. Design correct, désormais documenté ici. |
| ❌ | «Race webhook/login sur la même vente → double crédit» | Rejeté : les deux chemins utilisent la même reference `chariow:<sale_id>` ; les transactions Admin Firestore sont sérialisables et écrivent le même `users/{uid}` → contention → retry → le perdant voit l'entrée ledger et no-op. |
| ❌ | «Texte PDF en blanc pour être coloriable» | Rejeté (le blanc sur papier blanc est illisible) ; la demande produit était l'inverse : texte **noir** (fait, voir P1). |
| 📋 | **URLs signées Storage 1 an** | Trade-off assumé : les URLs sont persistées en Firestore et affichées longtemps (les raccourcir casserait la bibliothèque). Bucket en deny-by-default, URLs non devinables. Plus tard : proxy `/api/images/[...]` re-signant à la volée via `illustration_path`. |
| 📋 | **Vision QC timeout 25 s** | Déjà configurable (`VISION_QC_TIMEOUT_MS`). Garder 25 s tant que Groq tier gratuit (les retries 429 en ont besoin) ; baisser après passage Dev Tier. |
| 📋 | **Polling 1,5 s → SSE** | Optimisation réseau réelle mais invasive ; le polling actuel porte maintenant l'auto-guérison du reaper. À considérer avec la refonte temps réel. |
| 📋 | **Harmonisation tu/vous** | L'app mélange les deux registres (landing « vous », parcours achat « tu » comme la fiche produit). Corrigé au cas par cas sur les écrans mixtes ; harmonisation complète = passe i18n dédiée (`preferred_language` existe déjà). |
| 📋 | **Qualité images (résiduels)** | Poses duo statiques (Kontext colle à la réf) → tester `flux-pro/kontext/max` + seconde passe LLM sur les actions ; texte parasite (noms) → garde OCR/vision → re-roll. Inchangé (itération dédiée, coûts benchs). |

## Sain (vérifié, aucun changement requis)

- **Crédits** : réservation atomique en transaction + idempotence `(operation, reference_id)` ; refunds bornés `Math.min(refund, cost)` ; essais = 0 réservation → aucun chemin de minage. Suite d'intégration 31/31 verte (étape 2).
- **Sécurité** : rules Firestore/Storage write-interdit côté client ; secrets jamais dans un bundle client ni une réponse API ; webhook constant-time fail-closed ; zod partout ; pas de `dangerouslySetInnerHTML` ; cookies httpOnly+secure+lax ; pas de GET mutant (CSRF ok) ; ownership vérifié sur toutes les ressources.
- **Pipeline** : QC vision fail-open, persistance Storage systématique, remboursements sur tous les chemins d'échec.
