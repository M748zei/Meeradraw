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
