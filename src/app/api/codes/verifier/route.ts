import { NextResponse } from 'next/server';
import { supabaseAnon } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vérifie un code promo SANS le consommer et SANS compte.
 * Toute la logique est dans la fonction SQL hub_verifier_code, ouverte à anon :
 * correspondance exacte uniquement, donc impossible d'énumérer les codes.
 * Aucune clé secrète nécessaire.
 */
export async function POST(request: Request) {
  let code = '';
  try {
    const body = (await request.json()) as { code?: unknown };
    code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  } catch {
    return NextResponse.json({ ok: false, raison: 'CODE_INCONNU' }, { status: 400 });
  }

  if (!code || code.length > 32 || !/^[A-Z0-9._-]+$/.test(code)) {
    return NextResponse.json({ ok: false, raison: 'CODE_INCONNU' });
  }

  const { data, error } = await supabaseAnon().rpc('hub_verifier_code', { p_code: code });
  if (error) return NextResponse.json({ ok: false, raison: 'ERREUR' }, { status: 500 });
  return NextResponse.json(data);
}
