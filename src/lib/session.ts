import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAsUser, supabaseServer } from './supabase';

/**
 * Résout « qui parle » pour une route d'API, dans cet ordre :
 *   1. en-tête Authorization: Bearer <jeton Supabase>  → une app produit qui agit
 *      au nom de l'utilisateur (MeeraDraw, Klik) ;
 *   2. cookie de session                                → le navigateur du hub.
 *
 * Dans les deux cas on renvoie un client Supabase soumis à RLS : impossible de
 * toucher au portefeuille de quelqu'un d'autre, même en cas de bug applicatif.
 */
export type Session =
  | { connecte: true; userId: string; email: string | null; client: SupabaseClient }
  | { connecte: false };

export async function resoudreSession(request: Request): Promise<Session> {
  const entete = request.headers.get('authorization') ?? '';
  const jeton = entete.toLowerCase().startsWith('bearer ') ? entete.slice(7).trim() : '';

  if (jeton) {
    const client = supabaseAsUser(jeton);
    const { data, error } = await client.auth.getUser(jeton);
    if (error || !data.user) return { connecte: false };
    return { connecte: true, userId: data.user.id, email: data.user.email ?? null, client };
  }

  const client = await supabaseServer();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { connecte: false };
  return { connecte: true, userId: user.id, email: user.email ?? null, client };
}
