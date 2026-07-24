# AUDIT — Meeradraw (2026-07-24)

Audit complet + corrections. Findings vérifiés dans le code avant action.
Statut : ✅ corrigé · 📋 reco · ❌ rejeté

## P0 / P1 — corrigés dans cette passe

| Statut | Sujet | Détail |
|---|---|---|
| ✅ | **Ownership univers à la création de livre** | `POST /api/books` acceptait n'importe quel `universe_id` → écritures cross-tenant à la génération. → `BookService.create` vérifie `universes/{id}.user_id === caller`. Liste univers filtrée aussi côté page. |
| ✅ | **SSRF cover_image → PDF** | `PATCH /api/books` acceptait une URL arbitraire ; `PDFService.embedRemoteImage` fetchait sans allowlist. → `cover_image` retiré du patch client ; fetch images centralisé (`lib/safe-image-url.ts`) avec hosts allowlistés + timeout + taille max. Idem StorageService (hostname exact, fail-closed hors allowlist). |
| ✅ | **Génération : crédits orphelins / double start** | Réservation avant doc génération + pas de lock livre. → claim transactionnel (doc gen + `active_generation_id` sur le livre) **avant** `reserve()` ; double-clic réutilise la gen en cours ; crash après claim toujours reapeable. |
| ✅ | **Essais gratuits concurrentiels** | Check `free_trials_used` hors transaction. → slot `free_trials_in_progress` réservé au start, consommé/libéré à la fin (orchestrateur + reaper). |
| ✅ | **Retry pages non récupérable / double charge** | `finally` pouvait ne pas tourner ; pages sélectionnées avant claim. → claim transactionnel + doc `generation_retries/{token}` + reaper étendu. |
| ✅ | **Licence : partage de clé + produit fail-open** | Clé active réutilisable cross-compte ; `CHARIOW_PRODUCT_ID` manquant = no-op. → un owner actif par `license.id` ; fail-closed en prod si Chariow configuré sans product id. |
| ✅ | **Remboursements Chariow ≠ clawback crédits** | `successful.sale` créditait ; refund/cancel ne reprenaient pas. → `reverseChariowSale` (debit borné au solde + dette tracée). |
| ✅ | **Open redirect login `?next=`** | → `safeInternalPath` (chemins relatifs only). |
| ✅ | **Page generate sans `gid` inert** | Lien « Voir la création » sans gid. → `active_generation_id` + résolution côté livre/page generate. |
| ✅ | **Fuite `license_key` via `/api/user`** | Spread du doc Firestore. → DTO `toPublicProfile` (clé masquée). |

## P2 — corrigés

| Statut | Sujet | Détail |
|---|---|---|
| ✅ | Rate limits retry / PDF / activate | Ajoutés (user + IP pour activate). |
| ✅ | PDF export data-URL non borné | Garde 800 KB (comme l'orchestrateur). |
| ✅ | Types `CreditLedger` / `qc_stats` / `active_generation_id` | Alignés sur Firestore. |
| ✅ | Stats dashboard plafonnées à 6 | Totaux avant `slice`. |
| ✅ | Headers sécu + middleware→proxy | CSP frame-ancestors, nosniff, HSTS prod ; `proxy.ts` (Next 16). |
| ✅ | `error.tsx` app + `.env.example` | UI d'erreur brandée ; secrets ops documentés (`CRON_SECRET`, etc.). |
| ✅ | Poll generate timeout cleanup | `clearTimeout` au unmount. |

## Recos restantes (non bloquantes)

| Statut | Sujet | Détail |
|---|---|---|
| 📋 | Pagination dashboard/library | Index composite `(user_id, created_at desc)` puis `orderBy+limit`. |
| 📋 | URLs Storage 1 an | Proxy `/api/images/...` pour re-signer. |
| 📋 | Rate limit Redis | Remplacer le limiteur mémoire si multi-instance intensif. |
| 📋 | Polling → SSE | Optimisation réseau ; le poll porte déjà l'auto-guérison reaper. |

## Vérifications

- `npx tsc --noEmit` : OK
- `npm run lint` : 0 erreur
- `npm run build` : OK (Next 16.2.10)
