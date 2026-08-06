import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

/** Client lié à la session par cookie (Server Components, routes « au nom de » l'utilisateur). */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv(url, 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv(anonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: (name: string, value: string, options: CookieOptions) => {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            /* appelé depuis un Server Component : ignorable */
          }
        },
        remove: (name: string, options: CookieOptions) => {
          try {
            cookieStore.set({ name, value: '', ...options, maxAge: 0 });
          } catch {
            /* idem */
          }
        },
      },
    },
  );
}

/** Client anonyme, sans session. Sert uniquement aux fonctions ouvertes (vérifier un code). */
export function supabaseAnon(): SupabaseClient {
  return createClient(
    requireEnv(url, 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv(anonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Client agissant avec le jeton d'un utilisateur : soumis à RLS, limité à ce compte. */
export function supabaseAsUser(accessToken: string): SupabaseClient {
  return createClient(
    requireEnv(url, 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv(anonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  );
}

/**
 * Client administrateur (service_role). Contourne RLS.
 * Uniquement nécessaire au webhook de paiement, qui doit créditer le compte
 * d'un tiers. Tout le parcours utilisateur fonctionne sans.
 */
export function supabaseAdmin(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.startsWith('placeholder')) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY absente : le webhook de paiement ne peut pas créditer de compte. " +
        "Ajoute la clé secrète Supabase dans les variables d'environnement.",
    );
  }
  return createClient(requireEnv(url, 'NEXT_PUBLIC_SUPABASE_URL'), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Le webhook est-il utilisable ? Sert à répondre proprement plutôt que planter. */
export function adminDisponible(): boolean {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(key && !key.startsWith('placeholder'));
}
