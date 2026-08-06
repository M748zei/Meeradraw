import { NextResponse } from 'next/server';
import { supabaseServer } from '../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Retour du lien de connexion envoyé par email.
 * Si un code promo accompagnait l'inscription, il est consommé ici — c'est le
 * moment où la personne existe enfin et où le portefeuille peut être crédité.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jeton = url.searchParams.get('code'); // code d'échange OAuth de Supabase
  const suite = url.searchParams.get('next') ?? '/compte';
  const codePromo = url.searchParams.get('code_promo') ?? url.searchParams.get('promo');

  const supabase = await supabaseServer();

  if (jeton) {
    const { error } = await supabase.auth.exchangeCodeForSession(jeton);
    if (error) {
      return NextResponse.redirect(new URL('/connexion?erreur=lien', url.origin));
    }
  }

  if (codePromo) {
    await supabase.rpc('hub_redeem_code', { p_code: codePromo });
  }

  return NextResponse.redirect(new URL(suite, url.origin));
}
