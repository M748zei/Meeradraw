# BLOCAGE — actions qui exigent un humain

## B1 — LE compte fal.ai est à sec : tout le studio attend ça
Constaté le 2026-08-06 en lançant la comparaison des modèles (§8 du brief) :
les 15 appels (5 scènes × flux-2-pro / flux-general / ideogram-v3) répondent
`User is locked. Reason: Exhausted balance.`

→ **Recharge le solde sur fal.ai/dashboard/billing** (c'est un paiement, je ne
peux pas le faire). Ensuite, pour finir le travail mesuré :
1. relance `node --import tsx /tmp/comparaison-modeles.mjs` (le script est prêt,
   il génère les 15 images dans le scratchpad et un resultats.json) ;
2. compare aux vraies images de la page (j'ai extrait des trames de référence
   des vidéos Kaocen/Lumumba du Bureau) ;
3. pose `FAL_STUDIO_ENDPOINT` sur le gagnant dans Vercel (défaut actuel du
   code : flux-2-pro).

Tant que le solde est vide, la génération en production échouera proprement :
débit remboursé automatiquement, message français, rien de perdu.

## B2 — Activer Google dans Supabase Auth
Toujours valable (voir historique) : provider Google à activer dans le
dashboard Supabase (`arijliuqbprqgqztuseh`) + URL de redirection
`https://meeradraw.vercel.app/auth/callback`. En attendant, le code par email
fonctionne.

## B3 — La preuve « débit + remboursement » en production exige ta connexion
Se connecter exige de saisir le code reçu par email — c'est exclu pour moi.
Une fois le solde fal rechargé, le test de 2 minutes sur ton téléphone :
1. https://meeradraw.vercel.app/login → code email → /studio
2. Décris une scène, choisis un preset, 2 variantes (3 crédits) → Générer
3. Vérifie : les images s'affichent, ton solde baisse de 3, la ligne
   `studio:…` apparaît dans hub_transactions (digiafrik.shop/compte).
   Pour voir le remboursement : relance quand le solde fal est vide → le
   débit est rendu (ligne `studio:…:refund`).
