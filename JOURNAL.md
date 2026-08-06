# JOURNAL — transformation MeeraDraw → Griot

- 18h20 — Cartographie faite (sans re-exploration : liste §4 suivie). Étape 1 lancée :
  suppression du moteur d'images (46 fichiers listés + orphelins `meeradraw-correctif-heros/`,
  `prompts.ts`, `prompts_1.ts`).
- 18h35 — Chaîne Chariow→Firestore supprimée aussi (voir DECISIONS.md D1) : elle créditait
  le portefeuille doublon. `services/ai` réduit au cœur Groq→OpenAI éprouvé.
- 18h45 — `tsc` vert, `next build` vert (13 pages). `.env.example` purgé des variables
  FAL_*/VISION_QC*/PRINT_*/SHEET_*/PAGE_GEN_*/STUDIO_*/PARENT_* ; CI simplifiée
  (lint + typecheck + suite Griot). Commit étape 1.
