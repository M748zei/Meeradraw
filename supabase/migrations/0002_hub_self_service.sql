-- 0002 — Le parcours complet sans clé secrète.
--
-- Avant : débiter/créditer passait par service_role, donc par une clé partagée
-- entre le hub et les apps. Une fuite de cette clé = un portefeuille ouvert.
--
-- Après : trois fonctions SECURITY DEFINER cadrées sur auth.uid(). L'appelant ne
-- choisit ni le montant (il vient de hub_tarifs) ni la personne (elle vient du
-- jeton). Seul le webhook de paiement garde besoin de service_role, parce que
-- créditer le compte d'un tiers est exactement ce que RLS interdit.

-- ── Le barème, en base plutôt qu'en dur dans le code ──────────────────────
create table if not exists public.hub_tarifs (
  action   text primary key,
  credits  integer not null check (credits > 0),
  libelle  text    not null,
  app      text    not null
);

insert into public.hub_tarifs (action, credits, libelle, app) values
  ('meeradraw.livre', 55, 'Livre de coloriage', 'meeradraw'),
  ('klik.kit',        12, 'Kit de vente',       'klik'),
  ('cartes.visuel',    3, 'Visuel produit',     'cartes')
on conflict (action) do update
  set credits = excluded.credits, libelle = excluded.libelle, app = excluded.app;

alter table public.hub_tarifs enable row level security;
drop policy if exists hub_tarifs_public on public.hub_tarifs;
create policy hub_tarifs_public on public.hub_tarifs for select
  to anon, authenticated using (true);

-- ── Vérifier un code sans le consommer, sans compte ───────────────────────
create or replace function public.hub_verifier_code(p_code text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c public.hub_promo_codes; norm text := upper(trim(p_code));
begin
  if norm is null or length(norm) = 0 or length(norm) > 32 then
    return jsonb_build_object('ok', false, 'raison', 'CODE_INCONNU');
  end if;

  select * into c from public.hub_promo_codes where code = norm;

  if c.code is null then return jsonb_build_object('ok', false, 'raison', 'CODE_INCONNU'); end if;
  if not c.is_active then return jsonb_build_object('ok', false, 'raison', 'CODE_DESACTIVE'); end if;
  if c.expires_at is not null and c.expires_at < now() then
    return jsonb_build_object('ok', false, 'raison', 'CODE_EXPIRE'); end if;
  if c.max_redemptions is not null and c.redemptions >= c.max_redemptions then
    return jsonb_build_object('ok', false, 'raison', 'CODE_EPUISE'); end if;

  return jsonb_build_object('ok', true, 'code', c.code, 'credits', c.credits, 'label', c.label);
end $$;

-- ── Débiter son propre portefeuille ───────────────────────────────────────
create or replace function public.hub_debit_self(p_action text, p_ref text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); t public.hub_tarifs; solde integer;
begin
  if uid is null then return jsonb_build_object('ok', false, 'raison', 'NON_CONNECTE'); end if;

  select * into t from public.hub_tarifs where action = p_action;
  if t.action is null then return jsonb_build_object('ok', false, 'raison', 'ACTION_INCONNUE'); end if;

  begin
    solde := public.hub_debit(uid, t.credits, t.app, t.libelle, p_ref,
                              jsonb_build_object('action', p_action));
  exception when others then
    if sqlerrm like '%SOLDE_INSUFFISANT%' then
      return jsonb_build_object('ok', false, 'raison', 'SOLDE_INSUFFISANT', 'cout', t.credits);
    end if;
    return jsonb_build_object('ok', false, 'raison', 'ERREUR');
  end;

  return jsonb_build_object('ok', true, 'debite', t.credits, 'solde', solde);
end $$;

-- ── Se faire rembourser une génération ratée ──────────────────────────────
create or replace function public.hub_refund_self(p_action text, p_ref text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); t public.hub_tarifs; solde integer;
begin
  if uid is null then return jsonb_build_object('ok', false, 'raison', 'NON_CONNECTE'); end if;
  if p_ref is null or length(p_ref) = 0 then
    return jsonb_build_object('ok', false, 'raison', 'REF_REQUISE'); end if;

  select * into t from public.hub_tarifs where action = p_action;
  if t.action is null then return jsonb_build_object('ok', false, 'raison', 'ACTION_INCONNUE'); end if;

  -- On ne rembourse que si le débit correspondant existe vraiment.
  if not exists (
    select 1 from public.hub_transactions
     where user_id = uid and ref = p_ref and delta = -t.credits
  ) then
    return jsonb_build_object('ok', false, 'raison', 'DEBIT_INTROUVABLE');
  end if;

  solde := public.hub_credit(uid, t.credits, 'remboursement',
             'Remboursement ' || t.libelle, p_ref || ':refund', t.app,
             jsonb_build_object('action', p_action));

  return jsonb_build_object('ok', true, 'credite', t.credits, 'solde', solde);
end $$;

-- ── Droits ────────────────────────────────────────────────────────────────
-- Postgres accorde EXECUTE à PUBLIC par défaut. Sans ces revoke, n'importe qui
-- pourrait appeler hub_credit via /rest/v1/rpc/ et se fabriquer des crédits.
revoke all on function public.hub_debit_self(text, text)   from public, anon, authenticated;
revoke all on function public.hub_refund_self(text, text)  from public, anon, authenticated;
revoke all on function public.hub_verifier_code(text)      from public, anon, authenticated;

grant execute on function public.hub_debit_self(text, text)  to authenticated;
grant execute on function public.hub_refund_self(text, text) to authenticated;
grant execute on function public.hub_verifier_code(text)     to anon, authenticated;
