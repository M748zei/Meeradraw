-- ============================================================================
-- 0004 — Griot : la fabrique de récits africains
--
-- Pourquoi ce produit plutôt qu'un autre : l'audience réelle de DigiAfrik n'est
-- pas dans la boutique Chariow (10 clients, aucune vente payante réelle), elle
-- est sur la page Facebook « Le Scarabée Noir » — 6 200 abonnés, « les histoires
-- vraies que l'Afrique n'a jamais oubliées : crimes, mystères et destins
-- africains ». Un reel par jour, en français, avec une formule d'écriture
-- constante et reconnaissable.
--
-- Griot fabrique exactement ce contenu-là : le script, le découpage plan par
-- plan, la description, les hashtags, les réponses aux commentaires. C'est du
-- TEXTE, pas de l'image — donc pas de budget d'images, pas de juge visuel, pas
-- de génération qui meurt à 90 %. C'est précisément la leçon de MeeraDraw.
-- ============================================================================

-- ── 1. Autoriser l'app « griot » dans le journal des transactions ──────────
-- La contrainte porte un nom généré par Postgres ; on la retrouve par sa
-- colonne plutôt que par un nom deviné.
do $$
declare nom text;
begin
  select con.conname into nom
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public'
     and rel.relname = 'hub_transactions'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%meeradraw%';

  if nom is not null then
    execute format('alter table public.hub_transactions drop constraint %I', nom);
  end if;
end $$;

alter table public.hub_transactions
  add constraint hub_transactions_app_check
  check (app is null or app in ('meeradraw','klik','cartes','videos','griot','hub'));

-- ── 2. Le tarif ─────────────────────────────────────────────────────────────
-- 8 crédits le récit complet. Repère : une recharge 400 crédits à 17 900 F
-- revient à ~45 F le crédit, soit ~360 F le récit. Une page qui publie tous les
-- jours consomme ~240 crédits par mois : c'est un abonnement de fait, sans
-- abonnement à gérer.
insert into public.hub_tarifs (action, credits, libelle, app) values
  ('griot.recit', 8, 'Récit complet', 'griot')
on conflict (action) do update
  set credits = excluded.credits, libelle = excluded.libelle, app = excluded.app;

-- ── 3. Les récits produits ──────────────────────────────────────────────────
-- On garde tout : c'est la bibliothèque de la personne, et c'est aussi ce qui
-- permet de ne jamais reproposer deux fois le même sujet.
create table if not exists public.griot_recits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  ref         text not null,               -- la même ref que le débit de crédits
  sujet       text not null,
  angle       text,                        -- crime, mystère, destin, bataille…
  pays        text,
  duree       text,                        -- court / moyen / long
  titre       text,
  contenu     jsonb not null default '{}'::jsonb,
  statut      text not null default 'pret' check (statut in ('pret','echec')),
  created_at  timestamptz not null default now()
);

create index if not exists griot_recits_user_idx
  on public.griot_recits(user_id, created_at desc);
create unique index if not exists griot_recits_ref_uidx
  on public.griot_recits(ref);

alter table public.griot_recits enable row level security;

-- Chacun ne voit que ses récits. L'écriture passe par la route serveur, qui
-- agit avec le jeton de la personne : pas de clé de service ici.
drop policy if exists griot_recits_lecture on public.griot_recits;
create policy griot_recits_lecture on public.griot_recits
  for select to authenticated using (user_id = auth.uid());

drop policy if exists griot_recits_ecriture on public.griot_recits;
create policy griot_recits_ecriture on public.griot_recits
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists griot_recits_maj on public.griot_recits;
create policy griot_recits_maj on public.griot_recits
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
