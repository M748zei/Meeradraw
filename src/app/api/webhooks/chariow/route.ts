import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { adminDisponible, supabaseAdmin } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook « Pulse » de Chariow.
 *
 * C'est la SEULE route qui a besoin de la clé service_role : elle crédite le
 * compte d'un tiers, ce que RLS interdit par construction.
 *
 * Sécurité en deux couches :
 *  1. un jeton dans l'URL (?token=…) ;
 *  2. si CHARIOW_WEBHOOK_SECRET est défini, une signature HMAC-SHA256 du corps brut.
 *
 * Idempotence : la contrainte unique (provider, provider_ref) sur hub_payments,
 * plus la ref passée à hub_credit, garantissent qu'un paiement rejoué ne crédite
 * qu'une seule fois.
 */

const EN_TETES_SIGNATURE = ['x-chariow-signature', 'x-signature', 'x-pulse-signature'];

function signatureValide(brut: string, request: Request): boolean {
  const secret = process.env.CHARIOW_WEBHOOK_SECRET;
  if (!secret) return true; // vérification désactivée tant que le secret n'est pas renseigné

  const attendue = createHmac('sha256', secret).update(brut).digest('hex');
  for (const nom of EN_TETES_SIGNATURE) {
    const recue = (request.headers.get(nom) ?? '').replace(/^sha256=/, '').trim();
    if (!recue) continue;
    const a = Buffer.from(recue);
    const b = Buffer.from(attendue);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

type Corps = Record<string, unknown>;

function lire(obj: Corps, chemin: string): unknown {
  return chemin.split('.').reduce<unknown>((acc, cle) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[cle];
    return undefined;
  }, obj);
}

function premier(obj: Corps, chemins: string[]): string | undefined {
  for (const c of chemins) {
    const v = lire(obj, c);
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return undefined;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const jetonAttendu = process.env.CHARIOW_WEBHOOK_TOKEN;
  if (!jetonAttendu || url.searchParams.get('token') !== jetonAttendu) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const brut = await request.text();
  if (!signatureValide(brut, request)) {
    return NextResponse.json({ ok: false, raison: 'SIGNATURE_INVALIDE' }, { status: 401 });
  }

  if (!adminDisponible()) {
    // On répond 503 plutôt que 200 : Chariow réessaiera une fois la clé posée.
    return NextResponse.json(
      { ok: false, raison: 'CLE_SERVICE_ABSENTE' },
      { status: 503 },
    );
  }

  let corps: Corps;
  try {
    corps = JSON.parse(brut) as Corps;
  } catch {
    return NextResponse.json({ ok: false, raison: 'JSON_INVALIDE' }, { status: 400 });
  }

  const evenement = premier(corps, ['event', 'type', 'trigger']) ?? '';

  // Chariow envoie « successful.sale » — avec un POINT. D'autres écritures
  // circulent selon les sources : « successful_sale », « sale.success ».
  // On accepte les trois séparateurs plutôt que de parier sur un seul : c'est
  // exactement ce qui a fait ignorer la première vraie vente (200 OK renvoyé,
  // aucun crédit accordé, aucune alerte — le pire des silences).
  const estVente = /successful[._-]?sale|sale[._-]?success|license[._-]?issued/i.test(evenement);
  if (evenement && !estVente) {
    return NextResponse.json({ ok: true, ignore: evenement });
  }

  const ref = premier(corps, ['data.sale.id', 'data.id', 'sale.id', 'id', 'data.order_id']) ?? '';
  const email = (
    premier(corps, [
      'data.customer.email',
      'data.sale.customer.email',
      'customer.email',
      'data.buyer_email',
      'email',
    ]) ?? ''
  ).toLowerCase();
  const produitId =
    premier(corps, ['data.product.id', 'data.sale.product.id', 'product.id', 'data.product_id']) ?? '';

  if (!ref) {
    return NextResponse.json({ ok: false, raison: 'REF_MANQUANTE' }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const { data: pack } = await admin
    .from('hub_credit_packs')
    .select('slug, label, credits')
    .eq('chariow_product_id', produitId)
    .maybeSingle();

  const credits = pack?.credits ?? 0;

  const { error: erreurPaiement } = await admin.from('hub_payments').insert({
    provider: 'chariow',
    provider_ref: ref,
    email: email || null,
    credits,
    // Chariow imbrique le montant : sale.amount = { value, currency, … }.
    amount:
      Number(
        premier(corps, [
          'sale.amount.value',
          'data.sale.amount.value',
          'amount.value',
          'data.amount',
          'amount',
        ]) ?? 0,
      ) || null,
    currency:
      premier(corps, [
        'sale.amount.currency',
        'data.sale.amount.currency',
        'amount.currency',
        'data.currency',
        'currency',
      ]) ?? 'XOF',
    status: 'paid',
    raw: { pack: pack?.label ?? null, produit: produitId, evenement, corps },
  });

  // 23505 = doublon : paiement déjà traité, on répond 200 pour stopper les réessais.
  if (erreurPaiement?.code === '23505') {
    return NextResponse.json({ ok: true, deja_traite: true });
  }
  if (erreurPaiement) {
    return NextResponse.json({ ok: false, raison: 'ENREGISTREMENT' }, { status: 500 });
  }

  if (credits === 0) {
    return NextResponse.json({ ok: true, note: 'produit sans crédits associés', produit: produitId });
  }
  if (!email) {
    return NextResponse.json({ ok: true, en_attente: 'email absent' });
  }

  const { data: userId } = await admin.rpc('hub_user_id_par_email', { p_email: email });
  if (!userId) {
    // Réclamé automatiquement à l'inscription (hub_reclamer_paiements).
    return NextResponse.json({ ok: true, en_attente: 'compte pas encore créé' });
  }

  const { data: solde, error: erreurCredit } = await admin.rpc('hub_credit', {
    p_user: userId as string,
    p_amount: credits,
    p_kind: 'achat',
    p_label: `Recharge ${pack?.label ?? ''}`.trim(),
    p_ref: `chariow:${ref}`,
    p_app: 'hub',
    p_metadata: { provider: 'chariow', produit: produitId, pack: pack?.slug },
  });

  if (erreurCredit) {
    return NextResponse.json({ ok: false, raison: 'CREDIT' }, { status: 500 });
  }

  await admin
    .from('hub_payments')
    .update({ user_id: userId })
    .eq('provider', 'chariow')
    .eq('provider_ref', ref);

  return NextResponse.json({ ok: true, credite: credits, solde });
}
