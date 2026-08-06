import { NextResponse } from 'next/server';
import { resoudreSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Consomme le code pour la personne connectée et crédite son solde. */
export async function POST(request: Request) {
  const session = await resoudreSession(request);
  if (!session.connecte) {
    return NextResponse.json({ ok: false, raison: 'NON_CONNECTE' }, { status: 401 });
  }

  let code = '';
  try {
    const body = (await request.json()) as { code?: unknown };
    code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  } catch {
    return NextResponse.json({ ok: false, raison: 'CODE_INCONNU' }, { status: 400 });
  }
  if (!code) return NextResponse.json({ ok: false, raison: 'CODE_INCONNU' }, { status: 400 });

  const { data, error } = await session.client.rpc('hub_redeem_code', { p_code: code });
  if (error) return NextResponse.json({ ok: false, raison: 'ERREUR' }, { status: 500 });
  return NextResponse.json(data);
}
