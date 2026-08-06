-- 0003 — Relier chaque produit Chariow à un nombre de crédits.
--
-- Les quatre recharges s'affichent dans /compte avec leur lien de paiement.
-- MeeraDraw et Klik restent vendus comme produits d'entrée : un achat crédite
-- exactement le nombre annoncé sur la fiche. is_active = false pour qu'ils
-- n'apparaissent pas dans la liste des recharges, tout en restant reconnus par
-- le webhook (qui cherche par chariow_product_id, sans filtre).
--
-- La policy RLS de hub_credit_packs filtre déjà sur is_active : même si une page
-- oublie le filtre, un visiteur ne voit que les recharges actives.

update public.hub_credit_packs set checkout_url = 'https://hymamcey.mychariow.shop/prd_0658xmlt' where chariow_product_id = 'prd_0658xmlt';
update public.hub_credit_packs set checkout_url = 'https://hymamcey.mychariow.shop/prd_68mvngwe' where chariow_product_id = 'prd_68mvngwe';
update public.hub_credit_packs set checkout_url = 'https://hymamcey.mychariow.shop/prd_0gsbsozy' where chariow_product_id = 'prd_0gsbsozy';
update public.hub_credit_packs set checkout_url = 'https://hymamcey.mychariow.shop/prd_7vx0ru3k' where chariow_product_id = 'prd_7vx0ru3k';

insert into public.hub_credit_packs
  (slug, label, credits, price_xof, chariow_product_id, checkout_url, sort_order, is_active)
values
  ('meeradraw-entree', 'MeeraDraw — offre de lancement', 120,  4900, 'prd_d2ik58za', 'https://hymamcey.mychariow.shop/prd_d2ik58za', 90, false),
  ('klik-entree',      'Klik — offre fondateur',         360, 13900, 'prd_fl4at9rv', 'https://hymamcey.mychariow.shop/prd_fl4at9rv', 91, false)
on conflict (slug) do update
  set credits            = excluded.credits,
      price_xof          = excluded.price_xof,
      chariow_product_id = excluded.chariow_product_id,
      checkout_url       = excluded.checkout_url,
      is_active          = excluded.is_active;
