/**
 * Disposable-email guard for signups. One account = one real email = the free
 * trials — throwaway domains would let anyone farm unlimited trials.
 *
 * The list targets the popular disposable providers (and their alias domains).
 * Matching covers subdomains too (`foo.yopmail.com`).
 */
const DISPOSABLE_DOMAINS = new Set([
  // Yopmail + aliases
  "yopmail.com", "yopmail.fr", "yopmail.net", "cool.fr.nf", "jetable.fr.nf",
  "courriel.fr.nf", "moncourrier.fr.nf", "monemail.fr.nf", "monmail.fr.nf",
  // Mailinator + aliases
  "mailinator.com", "mailinator.net", "mailinator.org", "mailinater.com",
  "reallymymail.com", "suremail.info", "thisisnotmyrealemail.com",
  // Guerrilla Mail
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamail.de", "guerrillamail.info",
  "grr.la", "sharklasers.com", "pokemail.net", "spam4.me",
  // Temp-mail family
  "temp-mail.org", "temp-mail.io", "tempmail.com", "tempmail.net",
  "tempmail.dev", "tempmailo.com", "tempail.com", "temp-mail.ru",
  "mail-temp.com", "tmpmail.org", "tmpmail.net", "tmpeml.com", "tmp-mail.org",
  // 10 minute mail
  "10minutemail.com", "10minutemail.net", "10minemail.com", "10minutemail.co.za",
  "20minutemail.com", "30minutemail.com", "minutemail.com",
  // Throwaway / trash
  "throwawaymail.com", "trashmail.com", "trashmail.de", "trashmail.me",
  "trash-mail.com", "kurzepost.de", "wegwerfmail.de", "wegwerfmail.net",
  // Other popular disposables
  "maildrop.cc", "mailnesia.com", "mintemail.com", "mohmal.com",
  "getnada.com", "nada.email", "inboxkitten.com", "dispostable.com",
  "fakeinbox.com", "mailcatch.com", "spamgourmet.com", "mytemp.email",
  "burnermail.io", "emailondeck.com", "moakt.com", "tempinbox.com",
  "disposablemail.com", "crazymailing.com", "tempr.email", "discard.email",
  "mailexpire.com", "spambox.us", "mailsac.com", "inboxbear.com",
  "guerillamail.com", "dropmail.me", "harakirimail.com", "33mail.com",
  "emailfake.com", "email-fake.com", "generator.email", "luxusmail.org",
  "vomoto.com", "fexbox.org", "mailpoof.com", "cachedot.net",
]);

export function isDisposableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // Subdomain of a disposable provider (e.g. anything.yopmail.com).
  return [...DISPOSABLE_DOMAINS].some((d) => domain.endsWith(`.${d}`));
}
