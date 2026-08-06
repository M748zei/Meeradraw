import { NextResponse } from 'next/server';
import { resoudreSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await resoudreSession(request);
  if (!session.connecte) {
    return NextResponse.json({ ok: false, raison: 'NON_CONNECTE' }, { status: 401 });
  }

  const { data } = await session.client
    .from('hub_wallets')
    .select('balance, currency')
    .eq('user_id', session.userId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    solde: data?.balance ?? 0,
    devise: data?.currency ?? 'XOF',
  });
}
