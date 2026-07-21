# Meeradraw

Plateforme SaaS pour créer des livres de coloriage à partir d'une simple idée.

## Firebase project (actif)

- **Project ID:** `bookstudioai-8eadb`
- **Console:** https://console.firebase.google.com/project/bookstudioai-8eadb/overview
- Auth Email/Password + Google : activés
- Firestore `(default)` + rules
- Admin SDK : configuré dans `.env.local`
- Storage : exports PDF sous `exports/{userId}/…` (lecture propriétaire uniquement)


## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4 + Framer Motion
- **Firebase** (Auth, Firestore, Storage)
- OpenAI + fal.ai (abstraction IA)
- Stripe (crédits)
- pdf-lib + Vercel

## Démarrage

```bash
cp .env.example .env.local
npm install
npm run dev
```

### Firebase

Client config is wired for project **`bookstudioai-8eadb`** in `.env.local`.

Still required in the Firebase Console:

1. Activez **Authentication** (Email/Password + Google)
2. Créez une base **Firestore**
3. Activez **Storage**
4. Générez une clé de compte de service (Project settings → Service accounts) et renseignez `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` dans `.env.local`
5. Déployez les règles :

```bash
npx -y firebase-tools@latest deploy --only firestore:rules,storage
```

### Mode démo

Avec `MOCK_AI=true` et sans Firebase, la landing et l'UI fonctionnent.
Auth / CRUD / génération nécessitent Firebase Admin configuré.

## Parcours MVP

Landing → Inscription → Dashboard → Univers → Livre de coloriage → Génération → PDF → Crédits
