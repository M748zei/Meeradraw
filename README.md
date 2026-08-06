# Griot

Griot fabrique des récits d'**histoires vraies africaines** prêts à publier sur
Facebook et TikTok — le travail que l'auteur du « Scarabée Noir » fait à la main
chaque jour : accroches, script à lire mot pour mot, plans avec images à
chercher, description, question à épingler, hashtags, réponses aux commentaires,
version TikTok, et la liste **« à vérifier avant de publier »** (jamais vide).

## Architecture

- **Next.js (App Router)** sur Vercel — un seul écran : `/griot`.
- **Auth : Supabase** (projet hub `arijliuqbprqgqztuseh`). Code par email
  fonctionnel ; bouton Google prêt (provider à activer, voir `BLOCAGE.md`).
- **Portefeuille : celui du hub DigiAfrik, unique.** Débit de 8 crédits par
  récit via `hub_debit_self('griot.recit', ref)`, remboursement automatique à
  la même `ref` si la génération échoue (`hub_refund_self`). Jamais de clé de
  service : les fonctions SQL sont `SECURITY DEFINER` cadrées sur `auth.uid()`.
- **Moteur texte : Groq d'abord, OpenAI en secours** (`services/ai/openai-provider.ts`),
  formule d'écriture et honnêteté factuelle dans `services/griot/`.
- Les récits sont archivés dans `griot_recits` (RLS par utilisateur).

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

## Invariants du moteur (testés)

- La concaténation des `plans[].narration` redonne le `script` à l'identique.
- `a_verifier` n'est jamais vide.
- Aucun emoji dans le texte parlé ; jamais de chiffre sec quand les sources
  divergent (fourchette) ; on raconte, on n'accuse pas.
- Un JSON emballé/incomplet ne plante jamais : normalisé ou relancé une fois.
- Débit **après** vérification de disponibilité du service, remboursement
  bruyant et idempotent en cas d'échec.
