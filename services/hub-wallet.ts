import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Portefeuille du hub DigiAfrik — l'UNIQUE portefeuille (voir DECISIONS.md D1).
 * Chaîne prouvée : Chariow → Moneroo → webhook hub → hub_wallets → ici.
 *
 * Les fonctions SQL sont SECURITY DEFINER cadrées sur auth.uid() : le client
 * passé ici doit porter la session de l'utilisateur (jamais de clé de service).
 */

export type DebitResult =
  | { ok: true; debite: number; solde: number }
  | { ok: false; raison: "NON_CONNECTE" | "ACTION_INCONNUE" | "SOLDE_INSUFFISANT" | "ERREUR"; cout?: number };

export type RefundResult =
  | { ok: true; credite: number; solde: number }
  | { ok: false; raison: "NON_CONNECTE" | "REF_REQUISE" | "ACTION_INCONNUE" | "DEBIT_INTROUVABLE" };

/** Débite le tarif de `action` (vérité : hub_tarifs). `ref` = clé d'idempotence des deux côtés. */
export async function debiterAction(
  supabase: SupabaseClient,
  action: string,
  ref: string
): Promise<DebitResult> {
  const { data, error } = await supabase.rpc("hub_debit_self", {
    p_action: action,
    p_ref: ref,
  });
  if (error) {
    console.error("[hub-wallet] hub_debit_self a échoué", { action, ref, error: error.message });
    return { ok: false, raison: "ERREUR" };
  }
  return data as DebitResult;
}

/**
 * Rembourse le débit portant la même `ref`. La fonction SQL vérifie que le
 * débit existe et pose `ref:refund` — un double appel ne recrédite pas deux fois.
 * Un échec de remboursement se journalise BRUYAMMENT : c'est de l'argent client.
 */
export async function rembourserAction(
  supabase: SupabaseClient,
  action: string,
  ref: string
): Promise<RefundResult> {
  const { data, error } = await supabase.rpc("hub_refund_self", {
    p_action: action,
    p_ref: ref,
  });
  if (error) {
    console.error(
      `[hub-wallet] ÉCHEC DE REMBOURSEMENT — intervention requise. action=${action} ref=${ref} err=${error.message}`
    );
    return { ok: false, raison: "DEBIT_INTROUVABLE" };
  }
  const result = data as RefundResult;
  if (!result.ok) {
    console.error(
      `[hub-wallet] ÉCHEC DE REMBOURSEMENT — intervention requise. action=${action} ref=${ref} raison=${result.raison}`
    );
  }
  return result;
}

/** Solde du portefeuille de l'utilisateur connecté (null si pas de session/portefeuille). */
export async function lireSolde(supabase: SupabaseClient): Promise<number | null> {
  const { data, error } = await supabase
    .from("hub_wallets")
    .select("balance")
    .maybeSingle();
  if (error || !data) return null;
  return (data as { balance: number }).balance;
}
