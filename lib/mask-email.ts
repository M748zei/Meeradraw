/** Partially mask an email for UI: a***@domaine.com */
export function maskEmail(email: string | null | undefined): string {
  const normalized = (email || "").trim().toLowerCase();
  const at = normalized.indexOf("@");
  if (at < 1) return "***";
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}
