# DECISIONS — prises seul, en autonomie

## D1 — Suppression de la chaîne Chariow→Firestore (au-delà de la liste §4.1)
La liste de suppression imposait `config/credits.ts` et `services/credit-service.ts`.
Or `app/api/access`, `app/api/license`, `app/api/checkout`, `services/access-open.ts`,
`services/chariow-sale.ts` et `app/api/webhooks/chariow` ne font qu'une chose :
créditer le portefeuille **Firestore local** — exactement le doublon que §4.3 interdit.
Les « repointer » vers le hub est impossible sans clé de service partagée (rejetée
explicitement par la migration 0002 du hub). Décision : **supprimés**. Les achats de
crédits passent par la chaîne du hub, prouvée de bout en bout (Chariow → Moneroo →
webhook → crédits). Réversible : tout est dans l'historique git.

## D2 — Pages MeeraDraw supprimées
`/library`, `/profile`, `/settings`, `/credits`, `/license`, `/merci`,
`/ouvrir-mon-acces` : couplées aux livres/licences Firestore. Supprimées.
`/dashboard` → redirection vers `/griot` (l'écran unique).

## D3 — `services/ai` réduit au cœur éprouvé
`openai-provider.ts` gardé mais réduit aux briques prouvées (client Groq→OpenAI,
bascule sur échec, timeouts issus de l'incident 3296e412). Les méthodes du domaine
« livre » (plan d'histoire, bible de personnages) sont supprimées avec leurs modules.
`research.ts` (Tavily/Serper/DuckDuckGo) conservé pour l'ancrage factuel des récits.

## D4 — `lib/firebase/*` conservé en référence, non branché
Exigé par §4.2 (bascule popup→redirect iOS). L'auth active devient Supabase (option c
de §4.3). Les fichiers compilent mais ne sont plus le chemin de connexion.

## D5 — `detectImageFormat` inliné dans `services/pdf-service.ts`
`lib/image-format.ts` était dans la liste de suppression, mais `pdf-service.ts` est
dans la liste de conservation et en dépendait. 15 lignes de sniff magic-bytes inlinées.

## D6 — Suite de tests : échec volontaire tant qu'elle est vide
`npm test` échoue tant que la vraie suite (étape 3) n'existe pas, pour qu'aucun
vert CI ne puisse mentir.
