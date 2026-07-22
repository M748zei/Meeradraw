# ROADMAP — Meeradraw (projet CHARIOW)

Dernière mise à jour : 2026-07-21

---

## ✅ Terminé

- Architecture SaaS complète : Next.js 16 (App Router) + React 19 + Firebase
  (Auth, Firestore, Storage) + IA (Groq/OpenAI + fal.ai) + Stripe + pdf-lib.
- Pipeline de génération de livres de coloriage (recherche → storyboard →
  bible des personnages → model sheet → cover → pages → PDF).
- Système de contrôle qualité des images (détection blank/coloré, re-roll fal).
- Cohérence des personnages (visualLock, référence Kontext).
- Auth Firebase (email/password + Google), sessions par cookie.
- Système de licence Chariow (activation, statut, webhooks, `requireActiveLicense`).
- Crédits internes (usage) + achat via Stripe.
- **[2026-07-21] Correction des bugs critiques de facturation** :
  réservation atomique + remboursement (crédits), idempotence Stripe/Chariow,
  matching produit Chariow sur `product.id` (fail-closed), webhook Chariow
  conforme à l'API réelle, sécurité webhook (constant-time, fail-closed).
- **[2026-07-21] Lint propre** (0 erreur) + guards de robustesse (NaN env).
- **[2026-07-21] Refonte design/UX** (landing, dashboard, page licence) +
  push GitHub (M748zei/Meeradraw).
- **[2026-07-21] 🚀 EN PRODUCTION : https://meeradraw.digiafrik.shop** —
  projet Vercel `meeradraw` lié au repo GitHub (déploiement auto sur push),
  22 variables d'env de prod configurées, domaine actif (DNS auto via
  nameservers Vercel), auth E2E validée en prod (signup → session → profil
  + 30 crédits), gate licence Chariow actif.

- **[2026-07-22] 🎨 SPRINT QUALITÉ IMAGES (P0)** : storyboard structuré (actions
  physiques, poses, caméra, décor par page, ordre d'introduction), Kontext
  découplé identité/composition (prompt compact + crops solo, validés par
  benchmark), setting bible par univers + negatives dérivés, QC vision Groq
  (cast/espèces/quadrupède/anti-lineup/action/titre, fail-open, `qc_stats`),
  cover affiche avec titre composité serveur, **persistance Storage de toutes
  les images + migration 138/138 URLs fal (0 perte)**.

- **[2026-07-22] 💳 ÉTAPE 2 — Monétisation Chariow complète** : 3 essais
  gratuits (6 p) par compte + anti email jetable ; packs de crédits FCFA
  (120/150/400/900/2000 cr) mappés aux produits Chariow ; créditation
  idempotente sur `successful.sale` + réconciliation email inconnu ;
  `/api/checkout` (Checkout API, téléphone mémorisé) + `/merci` ; vocabulaire
  client « accès / code d'accès » ; Stripe retiré. 31 tests verts.

## 🔄 En cours

- Finalisation post-mise en ligne (voir ci-dessous).

### Raffinement images (itération suivante)
- [ ] Dynamisme des poses duo : Kontext colle encore parfois à la pose de la
      référence (tester flux-pro/kontext/max, seconde passe LLM sur les actions).
- [ ] Garde anti-texte parasite dans les pages (OCR/vision → re-roll).

## 📋 À faire

### Finalisation mise en ligne
- [ ] Firebase Console → Auth → Authorized domains : ajouter
      `meeradraw.digiafrik.shop` (requis pour la connexion Google).
- [ ] Test génération complète en prod avec un email `ADMIN_EMAILS`
      (idée → livre → PDF).
- [x] **[2026-07-21]** Règles Firestore + Storage **durcies** (write client
      interdit partout — protège `credits`/`chariow_license` ; tout passe par
      l'Admin SDK) et **déployées** via l'API firebaserules (service account).
      Index : aucun requis pour l'instant (`firestore.indexes.json` vide).
- [x] **[2026-07-22]** Pulse webhook Chariow configuré et vérifié E2E en prod
      (200 token valide / 403 fail-closed).
- [x] **[2026-07-22]** Produit accès `prd_d2ik58za` relié : `CHARIOW_PRODUCT_ID`,
      `NEXT_PUBLIC_CHARIOW_STORE_URL`, `CHARIOW_API_KEY` posés en prod +
      matching produit vérifié E2E (licence Klik → 403).
- [ ] ~~Stripe~~ → remplacé par les packs de crédits Chariow (étape 2).

### Qualité & fonctionnalités
- [ ] Reaper pour les livres bloqués en statut `generating` (timeout).
- [ ] Cache TTL de validation de licence (`last_validated_at` déjà écrit,
      pas encore lu) pour réduire la dépendance à la latence Chariow.
- [ ] Aligner les interfaces TypeScript `Character` / `Page` sur les champs réels
      écrits en Firestore (`id_key`, `negative_prompt`, etc.).
- [ ] Nettoyage : retirer `dev/gen-test` avant prod (ou le garder strictement
      gated), retirer le shim `prompt-engine.ts`.
- [ ] Types de livres additionnels (storybook / activitybook / workbook) —
      actuellement `available:false`.
- [ ] Pagination des listes (books / universes) au lieu du tri en mémoire.

### Idées futures
- [ ] Éditeur de pages (réordonner, éditer le texte, régénérer une page ciblée).
- [ ] Prévisualisation PDF dans l'app.
- [ ] Multi-langue de l'UI (déjà `preferred_language` dans le profil).
- [ ] Tableau de bord d'usage (crédits consommés, historique de génération).
