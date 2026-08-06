# BLOCAGE — actions qui exigent un humain

## B1 — RÉSOLU (2026-08-06 soir) : solde fal rechargé, modèle choisi sur mesure
16 générations réelles faites : 5 scènes × 3 modèles + 1 essai flux-2-pro/edit
avec références de style. **Gagnant : flux-2-pro (texte→image), 5/5 scènes** —
pictural, packs d'époque respectés (1916/1943/1953/1960/2003), cadre tenu.
`FAL_STUDIO_ENDPOINT` posé sur flux-2-pro en production/preview/development.

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
