# Spec : le livre de coloriage parfait (référence canonique)

Source de vérité pour la qualité de génération de Meeradraw. Toute évolution du
"cerveau" IA (`services/ai/*`) doit respecter cette spec.

## Rôle

Directeur artistique senior + illustrateur jeunesse + designer éditorial expert **Amazon KDP**.
Objectif : des livres de coloriage qui donnent **vraiment** l'impression d'avoir été
achetés en librairie.

## Exigences

1. **Rendu** : line art **noir et blanc**, propre, imprimable. **Sans ombrage gris ni
   remplissage lourd**.
2. **Bible visuelle des personnages** : tous les détails stables à respecter sur chaque page.
3. **Storyboard page par page** : vraie progression narrative + **variété de scènes**.
   Pas de pages isolées, pas de personnages uniquement de face.
4. **Cohérence stricte** : mêmes **visages, coiffures et tenues** d'une page à l'autre.
5. **Par page** : un **titre** + un **prompt image autonome très précis** + un **negative prompt**.
6. **Style cohérent** sur tout le livre.
7. **Structure de sortie** : titre du livre · concept · bible des personnages · storyboard
   complet avec prompts et negative prompts.
8. **Placeholders** : thème, nombre de pages, public.

## Où c'est appliqué (mapping code)

| Exigence | Implémentation |
|----------|----------------|
| Rôle DA / KDP | `CREATIVE_DIRECTOR_ROLE` + en-tête "NIVEAU LIBRAIRIE / AMAZON KDP" dans `buildStorySystemPrompt` (`services/ai/prompts.ts`) |
| N&B, sans gris/remplissage | `COLORING_CRAFT_POSITIVE` + `COLORING_NEGATIVE_PROMPT` (`prompts.ts`) |
| Bible personnages stable | `StoryCharacter.visualLock` (`types.ts`), `formatCharacterLock` / `normalizeStoryPlan` (`character-bible.ts`) — injecté à l'identique sur chaque page |
| Storyboard varié, pas de face-only | Section STORYBOARD + `shotType` varié + `comicBeat` (`prompts.ts`, `character-bible.ts`) |
| Mêmes visages/coiffures/tenues | `visualLock` verrouillé + character model sheet de référence (fal) réutilisée par page (`generation-orchestrator.ts`, `fal-provider.ts`) |
| Titre + prompt + negative / page | `pages[].title`, `illustrationDescription`, `negativePrompt` (`types.ts`) ; négatif replié dans le positif pour Flux + `negative_prompt` réel pour SDXL/SD (`fal-provider.ts`) |
| Style cohérent | Thème unique propagé (`style`) + locks identiques + feuille de référence |
| Structure de sortie | JSON : `title`, `concept`, `characters[]`, `pages[]` (`prompts.ts`, `types.ts`) |
| Placeholders | `pageCount` (nb pages), `style` (thème), `audience` (public) — `buildStorySystemPrompt(pageCount, style, audience)` |

## Pipeline

```
idée → enrichIdea → buildResearchBrief → generateStoryPlan (concept + bible + storyboard)
     → normalizeStoryPlan (locks, cast, décor obligatoire, negative par défaut)
     → model sheet (fal) → cover → pages (fal, ref-guided) → PDF
```

## Réglages fal (env)

- `FAL_IMAGE_ENDPOINT` (défaut `flux/dev`), `FAL_REF_ENDPOINT` (Kontext, cohérence perso)
- `FAL_SEND_NEGATIVE=true|false` — forcer/désactiver l'envoi du `negative_prompt` réel
- `FAL_INFERENCE_STEPS`, `FAL_GUIDANCE_SCALE`, `FAL_REF_STRENGTH`, `PAGE_GEN_CONCURRENCY`
