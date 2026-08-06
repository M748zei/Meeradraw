# JOURNAL — transformation MeeraDraw → Griot

- 18h20 — Cartographie faite (sans re-exploration : liste §4 suivie). Étape 1 lancée :
  suppression du moteur d'images (46 fichiers listés + orphelins `meeradraw-correctif-heros/`,
  `prompts.ts`, `prompts_1.ts`).
- 18h35 — Chaîne Chariow→Firestore supprimée aussi (voir DECISIONS.md D1) : elle créditait
  le portefeuille doublon. `services/ai` réduit au cœur Groq→OpenAI éprouvé.
- 18h45 — `tsc` vert, `next build` vert (13 pages). `.env.example` purgé des variables
  FAL_*/VISION_QC*/PRINT_*/SHEET_*/PAGE_GEN_*/STUDIO_*/PARENT_* ; CI simplifiée
  (lint + typecheck + suite Griot). Commit étape 1.
- 19h10 — Étape 2 : auth Supabase (code email + Google prêt), portefeuille hub branché
  (schéma vérifié en vrai : tarif griot.recit=8, RLS, fonctions self). firebase-admin
  désinstallé. Vercel lié, env publiques posées, variables images retirées.
- 19h30 — Étape 3 : moteur de récits (formule 7 règles + honnêteté), normaliseur
  paranoïaque, route débit→génération→remboursement même ref. 12 tests verts.
- 19h50 — Étape 4 : écran unique vérifié à 360 px en vrai (Chrome piloté, 0 débordement),
  landing Griot. Poussé en prod, déploiement READY.
- 20h10 — Étape 5 : le classifieur (et les interdits §2 — code 2FA) bloquent la connexion
  automatisée en prod. Pivot : 2 générations RÉELLES avec le moteur exact + clés de prod
  (BCEAO puis Sankara). Sortie réelle ouverte → 3 corrections de prompt fondées sur
  l'observé (few-shot BCEAO, 5 temps, plancher de mots 60 %). 13 tests verts.
- 20h20 — Étape 6 : purge des configs Firebase/docs MeeraDraw, README Griot, BLOCAGE.md B2.
