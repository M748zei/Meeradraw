# BLOCAGE — actions qui exigent un humain

## B1 — Activer Google dans Supabase Auth (option c de §4.3)
Constat vérifié : `auth.identities` du projet `arijliuqbprqgqztuseh` ne contient que
le provider `email`. Le code est prêt (`signInWithOAuth({provider:"google"})` +
`/auth/callback` qui échange le code) mais il faut, à la main :
1. Google Cloud Console → créer un client OAuth 2.0 (type Web).
   - Origine autorisée : `https://arijliuqbprqgqztuseh.supabase.co`
   - URI de redirection : `https://arijliuqbprqgqztuseh.supabase.co/auth/v1/callback`
2. Supabase Dashboard → Authentication → Providers → Google → coller client ID
   + secret, activer.
3. Supabase Dashboard → Authentication → URL Configuration → ajouter
   `https://meeradraw.vercel.app/auth/callback` (et le domaine final de Griot)
   aux Redirect URLs.
En attendant, la connexion par code email (6 chiffres) fonctionne ; le bouton
Google affiche un message propre s'il échoue.

## B2 — La génération réelle EN PRODUCTION exige une connexion humaine
Le point 7 du cahier demande une génération lancée en production. La route
`/api/recits` est en ligne et échoue fermé sans session (vérifié : 401, rien
débité). Mais s'y connecter exige de saisir le code de connexion reçu par
email — exactement ce que les interdits du §2 proscrivent (« saisir… un code
2FA ») ; la tentative automatisée a d'ailleurs été refusée par la plateforme.

Ce qui a été prouvé à la place, avec le moteur EXACT du dépôt et les clés que
la production utilise : deux générations réelles (BCEAO 45 s, Sankara 45 s),
bascule Groq→relance observée, invariants tenus (voir rapport).

**À faire par toi (2 minutes, sur ton téléphone)** :
1. Ouvre https://meeradraw.vercel.app/login — entre ton adresse, tape le code
   à 6 chiffres reçu par email.
2. Sur /griot : touche un sujet d'exemple, touche « Écrire mon récit — 8 crédits ».
3. Vérifie : le récit s'affiche bloc par bloc, ton solde passe de 170 à 162,
   et la ligne de débit `griot:…` apparaît sur digiafrik.shop/compte.
