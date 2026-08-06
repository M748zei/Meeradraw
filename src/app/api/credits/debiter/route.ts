import { NextResponse } from 'next/server';
import { resoudreSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Débite le portefeuille de la personne connectée, avant une génération.
 *
 *   POST /api/credits/debiter
 *   Authorization: Bearer <jeton Supabase de l'utilisateur>
 *   { "action": "meeradraw.livre", "ref": "gen_abc123" }
 *
 * Le montant vient du barème en base (table hub_tarifs), jamais de l'appelant.
 * `ref` rend l'appel idempotent : un réessai ne débite pas deux fois.
 */
export async function POST(request: Request) {
  const session = await resoudreSession(request);
  if (!session.connecte) {
    return NextResponse.json({ ok: false, raison: 'NON_CONNECTE' }, { status: 401 });
  }

  let body: { action?: unknown; ref?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, raison: 'CORPS_INVALIDE' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const ref = typeof body.ref === 'string' && body.ref ? body.ref : null;
  if (!action) return NextResponse.json({ ok: false, raison: 'CORPS_INVALIDE' }, { status: 400 });

  const { data, error } = await session.client.rpc('hub_debit_self', {
    p_action: action,
    p_ref: ref,
  });
  if (error) return NextResponse.json({ ok: false, raison: 'ERREUR' }, { status: 500 });

  const res = data as { ok: boolean; raison?: string };
  if (!res.ok) {
    const status =
      res.raison === 'SOLDE_INSUFFISANT' ? 402 : res.raison === 'ACTION_INCONNUE' ? 400 : 500;
    return NextResponse.json(res, { status });
  }
  return NextResponse.json(res);
}
