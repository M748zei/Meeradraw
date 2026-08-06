import { AppError } from "@/lib/errors";
import { getSupabaseServer, isSupabaseServerConfigured } from "@/lib/supabase/server";

/**
 * Auth des routes API — session Supabase (cookies), identité unique du hub.
 * getUser() revalide le JWT auprès de Supabase : jamais de confiance aveugle
 * dans le cookie.
 */
export async function requireUser() {
  if (!isSupabaseServerConfigured()) {
    throw new AppError("INTERNAL_ERROR", "Service non configuré.", 503);
  }
  const supabase = await getSupabaseServer();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new AppError("UNAUTHORIZED", "Connexion requise", 401);
  }
  return {
    user: { id: user.id, email: user.email ?? undefined },
    supabase,
  };
}
