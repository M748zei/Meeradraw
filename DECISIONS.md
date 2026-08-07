# DECISIONS — Scarabée Studio, prises seul

## D1 — `fal-provider.ts` taillé au cœur protégé (conflit du brief tranché)
Le brief dit à la fois « ne touche pas à fal-provider.ts » et « supprime
vision-qc.ts, raster-gate.ts, character-bible.ts » — or fal-provider les
importait tous. Impossible de satisfaire les deux à la lettre. J'ai gardé
VERBATIM ce que le brief protège explicitement : `callFal` (timeout, erreurs
non réessayables) et `allegerPromptRefuse` — l'allègement automatique du
prompt sur 422 `content_policy_violation` (incident e3fc2591). Le pipeline
livre (QC visuel, re-rolls, verrouillage d'identité, prompts de coloriage)
est parti avec le produit livre. 1371 → 197 lignes.

## D2 — Le produit Griot (récits) remplacé par le Studio
L'app ne porte qu'un produit. Les briques réutilisées : auth Supabase,
portefeuille hub (généralisé en debiterAction/rembourserAction), coque à
360 px. Le reste (moteur de récits, /api/recits) est dans l'historique git.
La table griot_recits reste en base (données, on n'y touche pas).

## D3 — Réussite partielle des variantes : on livre et on annonce
4 variantes demandées, 3 réussies → on livre les 3 SANS remboourser (le
tarif est au pack) mais la réponse contient demandees/livrees et le log
crie. Alternative (rembourser la différence) impossible proprement :
hub_refund_self rembourse le tarif entier d'une action, pas un prorata.

## D4 — Une variante = un appel fal (pas num_images)
Chaque variante doit être régénérable seule (brief §2) et fal facture par
image ; N appels avec graines dérivées (base + i×7919) rendent chaque
vignette indépendante et réessayable.

## D5 — pdf-service supprimé
Gardé « pour ensuite » à l'époque du produit livre ; le studio ne produit
pas de PDF. L'orchestration livre, la couverture et les pages sont le
« ce qui ne sert plus » du §6. Historique git.

## D6 — Texte canvas : polices système condensées
Pas de webfont embarquée (poids, licence) : pile 'Archivo Narrow' /
'Roboto Condensed' / 'Arial Narrow' / Impact. Sur Android (le public),
Roboto Condensed est natif.

## D7 — Endpoint : flux-2-pro, choisi SUR MESURE (plus une supposition)
5 mêmes scènes sur flux-2-pro / flux-general / ideogram-v3, jugées à l'image
contre les trames réelles de la page (vidéos Kaocen/Lumumba) :
- flux-2-pro : 5/5 — huile cinématographique, sujet au tiers, packs d'époque
  exacts (auto à manivelle + vapeur en 1916, camions ronds en 1943, tirage
  argentique en 1960, berline et lampe tempête en 1953, taxis-brousse 2003).
- flux-general : beau mais photographique, pas pictural ; cadre dérive.
- ideogram-v3 : pictural mais affiche/naïf ; ignore le plan large (portraits
  géants) et la lumière demandée ; texte charabia.
- flux-2-pro/edit + 2 références de style : bon, mais deux sources de lumière,
  enseignes charabia, et des références à embarquer à chaque appel — l'avantage
  ne justifie pas le coût. Écarté.
`FAL_STUDIO_ENDPOINT=https://fal.run/fal-ai/flux-2-pro` posé partout.

## D8 — v2 : champs des presets hors table §3, choisis seul
Le parcours v2 ne listait pas les champs de 10 presets (hommage,
affiche-religieuse, scène-priere, document-epoque, carte-ancienne,
ville-nuit, nature-afrique, avatar-illustre, portrait-couple,
equipe-bureau) : déclarés par analogie avec leur famille (détail dans
services/studio/presets.ts). La clause négative saisie est retirée avec
son objet court (déterminant + nom + complément), pas jusqu'à la
ponctuation — « un homme sans chapeau marche » rend « un homme marche ».
Les clauses de lumière saisies (« en plein jour ») sont retirées de
toutes les saisies : la lumière vient du preset, et de lui seul.

## D9 — Vignettes honnêtes : une passe, graine fixe 314159
Générées par le preset lui-même (sujets de démonstration = les exemples
déclarés du preset), une seule passe, aucune sélection. produit-fond-uni
montre du monde derrière le produit là où le preset demande un fond uni —
c'est ce que l'utilisateur obtiendra, la vignette reste.
