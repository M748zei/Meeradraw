import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { resoudreSession } from '../../../../lib/session';
import { genererRecit, modeleDisponible } from '../../../../lib/griot/modele';
import { ANGLES, DUREES, type AngleId, type DureeId } from '../../../../lib/griot/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ACTION = 'griot.recit';

/**
 * Produit un récit complet et le facture.
 *
 * L'ordre compte, et il vient d'une leçon payée cher sur MeeraDraw : on débite
 * AVANT (sinon une génération réussie peut ne jamais être payée), mais on
 * rembourse AUTOMATIQUEMENT dès que la production échoue. La personne ne doit
 * jamais avoir à réclamer. Le débit et le remboursement partagent la même `ref`,
 * ce qui rend les deux opérations idempotentes : un double clic ne débite pas
 * deux fois, un double échec ne rembourse pas deux fois.
 */
export async function POST(request: Request) {
  const session = await resoudreSession(request);
  if (!session.connecte) {
    return NextResponse.json({ ok: false, raison: 'NON_CONNECTE' }, { status: 401 });
  }

  if (!modeleDisponible()) {
    // On refuse AVANT de débiter : pas de crédit prélevé pour un service
    // qu'on sait hors service.
    return NextResponse.json(
      { ok: false, raison: 'MODELE_INDISPONIBLE' },
      { status: 503 },
    );
  }

  let corps: Record<string, unknown>;
  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, raison: 'CORPS_INVALIDE' }, { status: 400 });
  }

  const sujet = typeof corps.sujet === 'string' ? corps.sujet.trim() : '';
  if (sujet.length < 8) {
    return NextResponse.json({ ok: false, raison: 'SUJET_TROP_COURT' }, { status: 400 });
  }
  if (sujet.length > 400) {
    return NextResponse.json({ ok: false, raison: 'SUJET_TROP_LONG' }, { status: 400 });
  }

  const angle = (ANGLES.find((a) => a.id === corps.angle)?.id ?? 'crime') as AngleId;
  const duree = (DUREES.find((d) => d.id === corps.duree)?.id ?? 'moyen') as DureeId;
  const pays = typeof corps.pays === 'string' ? corps.pays.trim().slice(0, 60) : '';

  const ref = `griot:${randomUUID()}`;

  // ── Débit ────────────────────────────────────────────────────────────────
  const { data: debit, error: erreurDebit } = await session.client.rpc('hub_debit_self', {
    p_action: ACTION,
    p_ref: ref,
  });
  if (erreurDebit) {
    return NextResponse.json({ ok: false, raison: 'ERREUR_DEBIT' }, { status: 500 });
  }
  const resDebit = debit as { ok: boolean; raison?: string; cout?: number; solde?: number };
  if (!resDebit.ok) {
    const status = resDebit.raison === 'SOLDE_INSUFFISANT' ? 402 : 400;
    return NextResponse.json(resDebit, { status });
  }

  // ── Production ───────────────────────────────────────────────────────────
  try {
    const recit = await genererRecit({ sujet, angle, pays, duree });

    // On archive : c'est la bibliothèque de la personne, et ça évite de
    // reproposer deux fois le même sujet.
    await session.client.from('griot_recits').insert({
      user_id: session.userId,
      ref,
      sujet,
      angle,
      pays: pays || null,
      duree,
      titre: recit.titre,
      contenu: recit,
      statut: 'pret',
    });

    return NextResponse.json({ ok: true, ref, recit, solde: resDebit.solde });
  } catch (err) {
    console.error('[griot] génération impossible', err);

    // ── Remboursement automatique ──────────────────────────────────────────
    // Même ref que le débit : hub_refund_self vérifie que le débit existe et
    // ne rend les crédits qu'une fois.
    let solde: number | undefined;
    try {
      const { data: remb } = await session.client.rpc('hub_refund_self', {
        p_action: ACTION,
        p_ref: ref,
      });
      const r = remb as { ok?: boolean; solde?: number } | null;
      if (r?.ok) solde = r.solde;
    } catch (e) {
      // Un remboursement raté ne doit pas masquer la cause réelle, mais il doit
      // laisser une trace : c'est de l'argent qui appartient à quelqu'un.
      console.error('[griot] REMBOURSEMENT ÉCHOUÉ pour', ref, e);
    }

    return NextResponse.json(
      {
        ok: false,
        raison: 'GENERATION_IMPOSSIBLE',
        rembourse: solde !== undefined,
        solde,
      },
      { status: 502 },
    );
  }
}
