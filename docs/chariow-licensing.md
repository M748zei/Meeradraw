# Fonctionnement de Chariow pour Meeradraw

Meeradraw n'est **pas** un SaaS vendu directement sur son propre site.

Le produit est distribué via **Chariow**, une marketplace de produits numériques.
Chariow gère la commercialisation. Notre application est le logiciel consommé après l'achat.

---

## Rôle de Chariow

Chariow est la **source de vérité** concernant les achats. Il prend en charge :

- la page de vente du produit ;
- l'encaissement des paiements ;
- la gestion des commandes ;
- l'envoi des e-mails de confirmation ;
- la distribution de la clé / licence d'accès ;
- les remboursements (si applicable) ;
- les renouvellements (abonnement Chariow).

Meeradraw ne remplace **jamais** ces fonctionnalités.

---

## Parcours utilisateur

1. Découverte sur Chariow  
2. Achat sur Chariow  
3. Paiement encaissé par Chariow  
4. Commande validée  
5. Licence / clé attribuée  
6. E-mail d'accès envoyé par Chariow  
7. Ouverture de Meeradraw  
8. Création de compte / connexion (Firebase Auth)  
9. Activation de la licence dans l'app (`/license`)  
10. Vérification serveur auprès de Chariow  
11. Licence valide → logiciel débloqué  
12. Licence invalide → accès refusé (nouvelles générations)

---

## Principe fondamental

| Oui | Non |
|-----|-----|
| Interroger Chariow | Créer des licences |
| Mémoriser un cache local du statut | Vendre des licences |
| Appliquer l'état renvoyé par Chariow | Décider soi-même si une licence est valide |

La licence appartient à Chariow. Chariow reste la référence.

---

## Séparation des responsabilités

**Chariow** : vente, paiement, commande, licence, e-mails d'achat.

**Meeradraw** : comptes, univers, livres, générations IA, crédits internes (usage), PDF, fichiers, préférences.

Les crédits Stripe éventuels mesurent l'**usage** dans le studio — ils ne remplacent pas l'achat du produit sur Chariow.

---

## Architecture

```
Frontend  →  API routes  →  LicenseService  →  lib/chariow (HTTP)
                              ↓
                         Firestore (cache local)
```

### `LicenseService`

Seul module autorisé à :

- communiquer avec Chariow ;
- vérifier une licence ;
- mémoriser son état local ;
- synchroniser les changements (API + webhooks) ;
- exposer un statut simple au reste de l'app.

Aucun autre module ne parle directement à Chariow.

### Vérifications serveur

Réalisées côté backend uniquement :

- à la demande de statut (`GET /api/license/status`) ;
- à l'activation (`POST /api/license/activate`) ;
- au lancement d'une génération (`requireActiveLicense`) ;
- via webhooks Chariow (`POST /api/webhooks/chariow`).

Le frontend ne décide jamais de la validité.

### Désactivation

Si Chariow indique une licence inactive (expiration, révocation, remboursement…) :

- nouvelles générations bloquées ;
- données utilisateur conservées ;
- invitation à réactiver une licence valide ;
- créations existantes accessibles en lecture selon les règles métier.

---

## Config

```env
# Requis en production pour vérifier / activer des licences.
# En local : laissez vide ou commenté — LicenseService bypass (générations OK, activation live désactivée).
CHARIOW_API_KEY=
CHARIOW_API_BASE=https://api.chariow.com/v1
CHARIOW_WEBHOOK_SECRET=
CHARIOW_PRODUCT_ID=          # optionnel : refuse les licences d'un autre produit
CHARIOW_PRODUCT_SLUG=        # optionnel : alternative au product id
NEXT_PUBLIC_CHARIOW_STORE_URL=https://...  # lien vers la page produit Chariow (landing + /license)
ADMIN_EMAILS=owner@example.com  # emails admin (séparés par virgule) — bypass Chariow
```

Les emails listés dans `ADMIN_EMAILS` ont un accès complet sans clé Chariow (`getStatus` → `valid: true`, `requireActiveLicense` laisse passer). Aucune fausse licence n'est créée.

Sans `CHARIOW_API_KEY` (dev) :

- `GET /api/license/status` → `configured: false`, `valid: true`, `required: false`
- `requireActiveLicense` laisse passer hors production
- `POST /api/license/activate` refuse (pas d'API)

Webhook URL à configurer chez Chariow : `{APP_URL}/api/webhooks/chariow`

## Docs API

https://chariow.dev/en/guides/licenses
