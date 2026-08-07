"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Connexion unique : toutes les applications vivent sous digiafrik.shop et
 * partagent le même projet Supabase, donc le même cookie de session. En
 * production, le cookie est posé sur le domaine PARENT — une connexion sur
 * digiafrik.shop vaut pour meeradraw.digiafrik.shop, et inversement.
 * En développement (localhost) : AUCUN domain, sinon le cookie est refusé.
 */
export const COOKIE_OPTIONS_SSO =
  process.env.NODE_ENV === "production"
    ? { domain: ".digiafrik.shop", path: "/", sameSite: "lax" as const, secure: true }
    : undefined;


/** Client Supabase côté navigateur (session en cookies, partagée avec le serveur). */
export function getSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    COOKIE_OPTIONS_SSO ? { cookieOptions: COOKIE_OPTIONS_SSO } : undefined
  );
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
