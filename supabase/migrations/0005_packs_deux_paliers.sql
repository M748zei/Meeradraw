-- 0005 — Ramène les recharges de quatre paliers à deux.
--
-- Pourquoi : depuis l'ouverture de la boutique le 11 juillet 2026, seuls
-- « Essentielle » (7 900 F) a été vendu, une fois. « Créateur », « Studio » et
-- « Business » sont à zéro vente. Ils étaient écrits pour des « revendeurs et
-- gros producteurs » — un client qui n'est jamais venu. Quatre choix sur un
-- téléphone, c'est trois hésitations de trop.
--
-- On garde : Essentielle (150 crédits) pour dépanner, Créateur (400 crédits)
-- pour celui qui produit vraiment.
-- On désactive : Studio et Business. Aucune ligne n'est supprimée, aucune
-- transaction n'est touchée. Réversible en repassant is_active à true.
--
-- Idempotente : rejouable sans effet de bord.

update hub_credit_packs
   set is_active = false
 where slug in ('studio', 'business');

-- Créateur devient le palier « généreux » affiché en second.
update hub_credit_packs
   set sort_order = 2
 where slug = 'createur';
