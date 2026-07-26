export const CHECKOUT_PHONE_COUNTRIES = {
  NE: "227",
  SN: "221",
  CI: "225",
  BJ: "229",
  TG: "228",
  BF: "226",
  ML: "223",
  CM: "237",
  GN: "224",
  CD: "243",
  GA: "241",
  FR: "33",
} as const;

export type CheckoutPhoneCountry = keyof typeof CHECKOUT_PHONE_COUNTRIES;

export type CheckoutPhone = {
  number: string;
  country_code: CheckoutPhoneCountry;
};

export function isCheckoutPhoneCountry(value: unknown): value is CheckoutPhoneCountry {
  return typeof value === "string" && value.toUpperCase() in CHECKOUT_PHONE_COUNTRIES;
}

/**
 * Return the numeric international form expected by downstream payment
 * providers. The UI deliberately accepts a familiar local number, so add the
 * selected country's calling code when it is absent.
 */
export function normalizeCheckoutPhone(value: unknown): CheckoutPhone | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as { number?: unknown; country_code?: unknown };
  if (typeof candidate.number !== "string" || !isCheckoutPhoneCountry(candidate.country_code)) {
    return null;
  }

  const country = candidate.country_code.toUpperCase() as CheckoutPhoneCountry;
  let digits = candidate.number.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);

  const dialCode = CHECKOUT_PHONE_COUNTRIES[country];
  if (!digits.startsWith(dialCode)) digits = `${dialCode}${digits}`;

  // ITU E.164 permits at most 15 digits. The shortest supported local numbers
  // in our markets still produce at least 8 digits with their calling code.
  if (digits.length < 8 || digits.length > 15) return null;

  return { number: digits, country_code: country };
}
