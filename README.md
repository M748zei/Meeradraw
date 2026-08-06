# MeeraDraw — le Midjourney africain

L'utilisateur décrit une scène **en français, en une phrase**. Il ne voit jamais
un prompt. Le style vient d'un des **30 presets** (portrait, commerce, famille,
foi, récit, réseaux) et l'**ancrage africain** — peaux, tissus, matériaux,
végétation, lumière — est injecté avant le sujet dans chaque image. C'est la
différence avec les outils mondiaux : ailleurs « un homme d'affaires » donne un
blanc à New York ; ici, un homme noir à Abidjan.

## Architecture

- **Next.js (App Router)** sur Vercel — trois écrans en un : `/studio`
  (la scène · le style · le cadre), plus un « Mode avancé » replié
  (consigne libre, modèle, région, graine).
- **Auth : Supabase** (projet hub `arijliuqbprqgqztuseh`). Code par email
  fonctionnel ; bouton Google prêt (provider à activer, voir `BLOCAGE.md`).
- **Portefeuille : celui du hub DigiAfrik, unique.** 1 image = 2 crédits,
  2 variantes = 3, 4 variantes = 6 (`hub_tarifs`, actions `studio.image*`).
  Débit avant l'appel via `hub_debit_self`, remboursement automatique à la
  même `ref` si tout échoue. Jamais de clé de service (SECURITY DEFINER sur
  `auth.uid()`).
- **Images : fal.ai** via le cœur éprouvé `callFal` (timeout, erreurs non
  réessayables, allègement automatique du prompt sur 422
  `content_policy_violation`). Compilateur pur dans `services/studio/`
  (presets + ancrage + époque), texte incrusté au canvas, jamais généré.

## Développement

```bash
npm install
npm run dev        # MOCK_AI=true dans .env.local pour travailler sans clés
npm test           # suite du moteur (parsing modèle, invariants)
npm run typecheck
npm run lint
```

Variables : voir `.env.example`. Décisions prises en autonomie : `DECISIONS.md`.
Actions restant à un humain : `BLOCAGE.md`.

## Invariants (testés — 12 tests, dont 1050 prompts de négation)

- Aucune négation dans un prompt compilé (30 presets × 5 heures × 7 régions),
  en anglais comme en français — un modèle de diffusion ne soustrait pas.
- L'ancrage africain précède toujours le sujet ; chaque région remplace
  matériaux et végétation ; « monde » l'omet explicitement.
- Les 7 presets [zone de texte] réservent leur plage vide dans le prompt.
- La consigne libre du mode avancé arrive toujours en DERNIER bloc.
- Débit après vérification de disponibilité, remboursement bruyant et
  idempotent, réussite partielle livrée et annoncée.
