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
- 20h40 — Nouveau brief : Scarabée Studio (studio d'images). §0 déjà fait (9d42163).
- 20h55 — Compilateur de prompt : 6 presets (recette nuit-archive du brief), pack
  d'époque, caméra non réglable, zéro négation testée FR+EN. 10/10.
- 21h05 — Tarifs studio posés en base (migration idempotente). Route /api/images :
  débit avant, une variante = un appel, remboursement même ref si tout échoue.
- 21h15 — Trois écrans + éditeur texte canvas + proxy image. Griot remplacé.
- 21h20 — §8 comparaison : LES 15 APPELS REFUSÉS — compte fal à sec (BLOCAGE B1).
  Trames de référence extraites des vidéos Kaocen/Lumumba pour juger après recharge.
- 21h30 — Ménage §6 : fal-provider taillé au cœur protégé (callFal + allègement 422
  verbatim), bagage livre supprimé. grep character-bible|vision-qc|raster-gate → vide.
- 21h45 — Alias mort /studio→/dashboard découvert par la sortie observée (307 en dev),
  retiré. Vérif 360 px au vrai navigateur : 3 écrans + variantes + éditeur canvas,
  0 débordement, export 37 Ko. Rebaptisé Scarabée Studio. Déploiement READY sur le
  dernier commit ; prod échoue fermé sans session (401, 0 transaction créée).
- 22h20 — Brief MeeraDraw : 30 presets en 6 familles (donnée pure), ancrage africain
  injecté avant le sujet + 6 régions + « monde », mode avancé replié (consigne libre
  en dernier bloc, modèle, région, graine), format 4:5. Test négations : 1050 prompts.
  Vérifié à 360 px (30 cartes, 7 badges zone de texte, mode avancé). Prod READY,
  « Scarabée » absent du HTML servi. fal toujours à sec (BLOCAGE B1 inchangé).
- 23h10 — Solde fal rechargé par le propriétaire. Comparaison §8 EXÉCUTÉE : 15 images
  (5 scènes × 3 modèles) + 1 essai flux-2-pro/edit avec références Kaocen recadrées.
  Jugement à l'image : flux-2-pro gagne 5/5 (pictural + époque + cadre). Endpoint figé
  par env sur les trois environnements. Le test de ressemblance est passé au passage :
  la scène du reel Kaocen retapée en une phrase redonne une image du même monde.
