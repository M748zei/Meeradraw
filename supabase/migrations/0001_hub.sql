-- ============================================================================
-- DigiAfrik Hub — schéma consolidé du portefeuille de crédits
-- Appliqué le 5 août 2026 sur le projet Supabase « klik » (arijliuqbprqgqztuseh)
-- en trois migrations : hub_wallet_core, hub_lock_down_functions,
-- hub_payments_claim. Ce fichier est leur état final réuni.
-- Toutes les tables sont préfixées hub_ : rien ne touche à licenses/projects.
-- ============================================================================

-- ---------------------------------------------------------------- Tables ---
create table if not exists public.hub_wallets (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  balance      integer not null default 0 check (balance >= 0),
  country      text,
  currency     text not null default 'XOF' check (currency in ('XOF','XAF','CDF')),
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.hub_transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  delta         integer not null,
  balance_after integer not null,
  kind          text not null check (kind in ('code','achat','debit','remboursement','ajustement','bonus')),
  app           text check (app in ('meeradraw','klik','cartes','videos','hub')),
  label         text not null,
  ref           text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists hub_transactions_user_idx on public.hub_transactions(user_id, created_at desc);
create unique index if not exists hub_transactions_ref_uidx on public.hub_transactions(ref) where ref is not null;

create table if not exists public.hub_promo_codes (
  code            text primary key,
  credits         integer not null check (credits > 0),
  label           text,
  source          text,
  max_redemptions integer,
  redemptions     integer not null default 0,
  once_per_user   boolean not null default true,
  is_active       boolean not null default true,
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.hub_redemptions (
  id         uuid primary key default gen_random_uuid(),
  code       text not null references public.hub_promo_codes(code) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  credits    integer not null,
  created_at timestamptz not null default now(),
  unique (code, user_id)
);

create table if not exists public.hub_payments (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null check (provider in ('chariow','moneroo')),
  provider_ref text not null,
  user_id      uuid references auth.users(id) on delete set null,
  email        text,
  credits      integer not null default 0,
  amount       numeric,
  currency     text,
  status       text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  raw          jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (provider, provider_ref)
);

create table if not exists public.hub_credit_packs (
  slug               text primary key,
  label              text not null,
  credits            integer not null check (credits > 0),
  price_xof          integer not null,
  chariow_product_id text,
  checkout_url       text,
  sort_order         integer not null default 0,
  is_active          boolean not null default true
);

-- ------------------------------------------------------------- Fonctions ---
create or replace function public.hub_ensure_wallet(p_user uuid)
returns public.hub_wallets
language plpgsql security definer set search_path = public as $$
declare w public.hub_wallets;
begin
  insert into public.hub_wallets(user_id) values (p_user) on conflict (user_id) do nothing;
  select * into w from public.hub_wallets where user_id = p_user;
  return w;
end $$;

create or replace function public.hub_credit(
  p_user uuid, p_amount integer, p_kind text, p_label text,
  p_ref text default null, p_app text default 'hub', p_metadata jsonb default '{}'::jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare new_balance integer;
begin
  if p_amount <= 0 then raise exception 'Le montant doit être positif'; end if;
  if p_ref is not null and exists (select 1 from public.hub_transactions where ref = p_ref) then
    select balance into new_balance from public.hub_wallets where user_id = p_user;
    return new_balance;
  end if;
  perform public.hub_ensure_wallet(p_user);
  update public.hub_wallets set balance = balance + p_amount, updated_at = now()
   where user_id = p_user returning balance into new_balance;
  insert into public.hub_transactions(user_id, delta, balance_after, kind, app, label, ref, metadata)
  values (p_user, p_amount, new_balance, p_kind, p_app, p_label, p_ref, p_metadata);
  return new_balance;
end $$;

create or replace function public.hub_debit(
  p_user uuid, p_amount integer, p_app text, p_label text,
  p_ref text default null, p_metadata jsonb default '{}'::jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare new_balance integer;
begin
  if p_amount <= 0 then raise exception 'Le montant doit être positif'; end if;
  if p_ref is not null and exists (select 1 from public.hub_transactions where ref = p_ref) then
    select balance into new_balance from public.hub_wallets where user_id = p_user;
    return new_balance;
  end if;
  perform public.hub_ensure_wallet(p_user);
  update public.hub_wallets set balance = balance - p_amount, updated_at = now()
   where user_id = p_user and balance >= p_amount returning balance into new_balance;
  if new_balance is null then
    raise exception 'SOLDE_INSUFFISANT' using errcode = 'P0001';
  end if;
  insert into public.hub_transactions(user_id, delta, balance_after, kind, app, label, ref, metadata)
  values (p_user, -p_amount, new_balance, 'debit', p_app, p_label, p_ref, p_metadata);
  return new_balance;
end $$;

create or replace function public.hub_redeem_code(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.hub_promo_codes; uid uuid := auth.uid(); new_balance integer; norm text := upper(trim(p_code));
begin
  if uid is null then return jsonb_build_object('ok', false, 'raison', 'NON_CONNECTE'); end if;
  select * into c from public.hub_promo_codes where code = norm for update;
  if c.code is null then return jsonb_build_object('ok', false, 'raison', 'CODE_INCONNU'); end if;
  if not c.is_active then return jsonb_build_object('ok', false, 'raison', 'CODE_DESACTIVE'); end if;
  if c.expires_at is not null and c.expires_at < now() then
    return jsonb_build_object('ok', false, 'raison', 'CODE_EXPIRE'); end if;
  if c.max_redemptions is not null and c.redemptions >= c.max_redemptions then
    return jsonb_build_object('ok', false, 'raison', 'CODE_EPUISE'); end if;
  if c.once_per_user and exists (select 1 from public.hub_redemptions where code = norm and user_id = uid) then
    return jsonb_build_object('ok', false, 'raison', 'DEJA_UTILISE'); end if;

  insert into public.hub_redemptions(code, user_id, credits) values (norm, uid, c.credits);
  update public.hub_promo_codes set redemptions = redemptions + 1 where code = norm;
  new_balance := public.hub_credit(uid, c.credits, 'code', coalesce(c.label, 'Code ' || norm),
    'code:' || norm || ':' || uid::text, 'hub', jsonb_build_object('code', norm, 'source', c.source));
  return jsonb_build_object('ok', true, 'credits', c.credits, 'solde', new_balance, 'code', norm);
end $$;

create or replace function public.hub_user_id_par_email(p_email text)
returns uuid
language sql security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) order by created_at limit 1;
$$;

-- Un paiement peut arriver avant que le compte n'existe : on le réclame ensuite.
create or replace function public.hub_reclamer_paiements(p_user uuid, p_email text)
returns integer
language plpgsql security definer set search_path = public as $$
declare p record; total integer := 0;
begin
  for p in select * from public.hub_payments
           where user_id is null and status = 'paid' and credits > 0
             and lower(email) = lower(trim(p_email))
  loop
    perform public.hub_credit(p_user, p.credits, 'achat',
      'Recharge ' || coalesce(p.raw->>'pack', p.provider),
      p.provider || ':' || p.provider_ref, 'hub',
      jsonb_build_object('provider', p.provider, 'ref', p.provider_ref));
    update public.hub_payments set user_id = p_user where id = p.id;
    total := total + p.credits;
  end loop;
  return total;
end $$;

create or replace function public.hub_on_auth_user_created()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.hub_wallets(user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email, new.phone))
  on conflict (user_id) do nothing;
  if new.email is not null then perform public.hub_reclamer_paiements(new.id, new.email); end if;
  return new;
end $$;

drop trigger if exists hub_on_auth_user_created on auth.users;
create trigger hub_on_auth_user_created
  after insert on auth.users for each row execute function public.hub_on_auth_user_created();

-- ------------------------------------------------------------------- RLS ---
alter table public.hub_wallets      enable row level security;
alter table public.hub_transactions enable row level security;
alter table public.hub_redemptions  enable row level security;
alter table public.hub_promo_codes  enable row level security;
alter table public.hub_payments     enable row level security;
alter table public.hub_credit_packs enable row level security;

drop policy if exists hub_wallets_self on public.hub_wallets;
create policy hub_wallets_self on public.hub_wallets
  for select to authenticated using (user_id = auth.uid());

drop policy if exists hub_transactions_self on public.hub_transactions;
create policy hub_transactions_self on public.hub_transactions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists hub_redemptions_self on public.hub_redemptions;
create policy hub_redemptions_self on public.hub_redemptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists hub_packs_public on public.hub_credit_packs;
create policy hub_packs_public on public.hub_credit_packs
  for select to anon, authenticated using (is_active);

-- hub_promo_codes et hub_payments : aucune policy => service_role uniquement.

-- --------------------------------------------------- Droits d'exécution ----
-- IMPORTANT : Postgres accorde EXECUTE à PUBLIC par défaut. Sans ces REVOKE,
-- n'importe qui pourrait appeler hub_credit via /rest/v1/rpc/hub_credit et se
-- fabriquer des crédits. Ne jamais retirer ce bloc.
revoke all on function public.hub_credit(uuid,integer,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.hub_debit(uuid,integer,text,text,text,jsonb)       from public, anon, authenticated;
revoke all on function public.hub_ensure_wallet(uuid)                            from public, anon, authenticated;
revoke all on function public.hub_on_auth_user_created()                         from public, anon, authenticated;
revoke all on function public.hub_user_id_par_email(text)                        from public, anon, authenticated;
revoke all on function public.hub_reclamer_paiements(uuid,text)                  from public, anon, authenticated;
revoke all on function public.hub_redeem_code(text)                              from public, anon;

grant execute on function public.hub_credit(uuid,integer,text,text,text,text,jsonb) to service_role;
grant execute on function public.hub_debit(uuid,integer,text,text,text,jsonb)       to service_role;
grant execute on function public.hub_ensure_wallet(uuid)                            to service_role;
grant execute on function public.hub_user_id_par_email(text)                        to service_role;
grant execute on function public.hub_reclamer_paiements(uuid,text)                  to service_role;
grant execute on function public.hub_redeem_code(text)                              to authenticated, service_role;

-- ---------------------------------------------------------- Données de base ---
insert into public.hub_credit_packs (slug,label,credits,price_xof,chariow_product_id,sort_order) values
  ('essentielle','Essentielle',150,7900,'prd_0658xmlt',1),
  ('createur','Créateur',400,17900,'prd_68mvngwe',2),
  ('studio','Studio',900,34900,'prd_0gsbsozy',3),
  ('business','Business',2000,69900,'prd_7vx0ru3k',4)
on conflict (slug) do update set credits=excluded.credits, price_xof=excluded.price_xof,
  chariow_product_id=excluded.chariow_product_id, label=excluded.label;

-- Un code par vidéo. Les montants sont à ajuster selon ce que tu veux offrir.
insert into public.hub_promo_codes (code,credits,label,source) values
  ('HISTOIRE20',20,'20 crédits offerts — vidéo Histoire','scarabee:histoire'),
  ('SANKARA30',30,'30 crédits offerts — vidéo Sankara','scarabee:sankara'),
  ('SCARABEE25',25,'25 crédits offerts — Le Scarabée Noir','scarabee:generique'),
  ('KEMET15',15,'15 crédits offerts — vidéo Kemet','scarabee:kemet')
on conflict (code) do update set credits=excluded.credits, label=excluded.label, source=excluded.source;
