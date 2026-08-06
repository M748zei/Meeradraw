import { NextResponse } from 'next/server';
import { resoudreSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rembourse une génération ratée. Le hub vérifie que le débit correspondant
 * existe vraiment avant de recréditer, et la ref « :refund » rend l'opération
 * idempotente.
 *
 *   POST /api/credits/crediter
 *   Authorization: Bearer <jeton Supabase>
 *   { "action": "meeradraw.livre", "ref": "gen_abc123" }
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
  const ref = typeof body.ref === 'string' ? body.ref : '';
  if (!action || !ref) {
    return NextResponse.json({ ok: false, raison: 'CORPS_INVALIDE' }, { status: 400 });
  }

  const { data, error } = await session.client.rpc('hub_refund_self', {
    p_action: action,
    p_ref: ref,
  });
  if (error) return NextResponse.json({ ok: false, raison: 'ERREUR' }, { status: 500 });

  const res = data as { ok: boolean; raison?: string };
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
