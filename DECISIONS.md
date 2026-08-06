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

## D7 — Endpoint par défaut : flux-2-pro, en attendant la mesure
La comparaison §8 est bloquée par le solde fal (BLOCAGE.md B1). Le défaut
du code est `FAL_STUDIO_ENDPOINT` (env) sinon flux-2-pro — le changement
de gagnant est une variable d'environnement, pas un déploiement.
