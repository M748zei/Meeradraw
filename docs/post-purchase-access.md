# Parcours post-achat Chariow → Meeradraw

## Redirection produit (dashboard Chariow)

```
https://meeradraw.digiafrik.shop/ouvrir-mon-acces?sale={sale_id}
```

Le placeholder `{sale_id}` est remplacé par Chariow (même convention que l’API Checkout `redirect_url`).

## Pulse / webhook

```
https://meeradraw.digiafrik.shop/api/webhooks/chariow?token=<CHARIOW_WEBHOOK_SECRET>
```

Événements officiels à activer :

- `successful.sale`
- `failed.sale`
- `abandoned.sale` (optionnel)
- `license.issued`
- `license.activated`
- `license.expired`
- `license.revoked`

Signature : HMAC-SHA256 du corps brut dans `x-chariow-signature` (best practice Chariow), **ou** le secret partagé en `?token=` / Bearer.

## Collections Firestore (Admin only)

- `chariow_purchases/{sale_id}` — achat + rattachement + accès
- `chariow_events/{event:id}` — idempotence Pulse
- `chariow_pending_credits/{sale_id}` — crédits si compte absent
- `licenses/{license_id}` — binding local
- `users/{uid}.chariow_license` — cache d’accès

Aucune migration SQL : schéma documentaire créé à l’écriture.
