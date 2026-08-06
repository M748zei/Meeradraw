import { NextResponse } from 'next/server';
import { resoudreSession } from '../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Tarif = { action: string; credits: number; libelle: string };

/**
 * « Qui suis-je, combien j'ai, et qu'est-ce que je peux me permettre ? »
 * Premier appel de MeeraDraw et Klik au chargement.
 */
export async function GET(request: Request) {
  const session = await resoudreSession(request);
  if (!session.connecte) {
    return NextResponse.json({ ok: false, raison: 'NON_CONNECTE' }, { status: 401 });
  }

  const [{ data: wallet }, { data: tarifs }] = await Promise.all([
    session.client
      .from('hub_wallets')
      .select('balance, currency, display_name')
      .eq('user_id', session.userId)
      .maybeSingle(),
    session.client.from('hub_tarifs').select('action, credits, libelle'),
  ]);

  const solde = wallet?.balance ?? 0;
  const liste = (tarifs as Tarif[] | null) ?? [];

  return NextResponse.json({
    ok: true,
    user_id: session.userId,
    email: session.email,
    nom: wallet?.display_name ?? null,
    solde,
    devise: wallet?.currency ?? 'XOF',
    tarifs: Object.fromEntries(liste.map((t) => [t.action, t.credits])),
    peut: Object.fromEntries(liste.map((t) => [t.action, solde >= t.credits])),
  });
}
