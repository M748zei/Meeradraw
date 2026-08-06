import { NextResponse } from 'next/server';
import { resoudreSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * La bibliothèque : les récits déjà produits par la personne connectée.
 *
 * RLS fait le travail de filtrage — la politique `griot_recits_lecture` limite
 * déjà à `user_id = auth.uid()`. Le `.eq()` explicite ci-dessous est une
 * ceinture en plus de la bretelle : si la politique est un jour modifiée par
 * erreur, la route ne se met pas à servir les récits des autres.
 */
export async function GET(request: Request) {
  const session = await resoudreSession(request);
  if (!session.connecte) {
    return NextResponse.json({ ok: false, raison: 'NON_CONNECTE' }, { status: 401 });
  }

  const { data, error } = await session.client
    .from('griot_recits')
    .select('id, sujet, angle, pays, duree, titre, contenu, created_at')
    .eq('user_id', session.userId)
    .eq('statut', 'pret')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ ok: false, raison: 'ERREUR' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, recits: data ?? [] });
}
