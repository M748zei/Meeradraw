export const CREDIT_COSTS = {
  colorbook_page: 2,
  storybook_page: 3,
  cover: 5,
  pdf_export: 1,
  regenerate_page: 2,
  regenerate_cover: 5,
} as const;

/**
 * Credit packs sold on Chariow (store DigiAfrik, prices in FCFA/XOF).
 * `chariowProductId` maps a `successful.sale` webhook to the credits to grant.
 * The `entry` pack is the Meeradraw access product itself: buying it unlocks
 * the studio (license) AND grants its credits.
 */
export const CREDIT_PACKS = [
  {
    id: "entry",
    name: "Accès Meeradraw",
    credits: 120,
    priceFcfa: 4900,
    description: "Débloque ton studio + de quoi créer 2 livres complets",
    chariowProductId: "prd_d2ik58za",
    unlocksAccess: true,
  },
  {
    id: "recharge",
    name: "Recharge",
    credits: 150,
    priceFcfa: 7900,
    description: "Environ 3 livres de coloriage complets",
    chariowProductId: "prd_0658xmlt",
  },
  {
    id: "creator",
    name: "Créateur",
    credits: 400,
    priceFcfa: 17900,
    description: "Le meilleur rapport pour créer une vraie collection",
    popular: true,
    chariowProductId: "prd_68mvngwe",
  },
  {
    id: "studio",
    name: "Studio",
    credits: 900,
    priceFcfa: 34900,
    description: "Pour les créateurs réguliers qui produisent en volume",
    chariowProductId: "prd_0gsbsozy",
  },
  {
    id: "business",
    name: "Business",
    credits: 2000,
    priceFcfa: 69900,
    description: "Revendeurs et gros producteurs (KDP, ateliers, écoles)",
    chariowProductId: "prd_7vx0ru3k",
  },
] as const;

export type CreditPack = (typeof CREDIT_PACKS)[number] & {
  unlocksAccess?: boolean;
};

export function packForChariowProduct(productId: string | null | undefined) {
  if (!productId) return null;
  return CREDIT_PACKS.find((p) => p.chariowProductId === String(productId)) ?? null;
}

export function formatFcfa(amount: number) {
  return `${amount.toLocaleString("fr-FR")} F CFA`;
}

/**
 * Free trials — the conversion hook. Every account can generate up to
 * FREE_TRIALS_MAX small books (≤ FREE_TRIAL_MAX_PAGES pages) without buying
 * access and without spending paid credits.
 */
export const FREE_TRIALS_MAX = 3;
export const FREE_TRIAL_MAX_PAGES = 6;

/** Per-page credit cost for a given book type. */
export function perPageCost(type: string = "colorbook") {
  return type === "storybook" ? CREDIT_COSTS.storybook_page : CREDIT_COSTS.colorbook_page;
}

export function estimateBookCost(pageCount: number, type: string = "colorbook") {
  return CREDIT_COSTS.cover + pageCount * perPageCost(type) + CREDIT_COSTS.pdf_export;
}

/**
 * Credit for pages that never rendered so the customer only pays for what was
 * actually produced. `plannedPages` is what we reserved for; `completedPages`
 * is how many came back with an image. When at least one page rendered, the
 * cover + PDF are considered delivered and kept; only the missing page credits
 * are refunded. When nothing rendered, the caller refunds the full reservation.
 */
export function refundForFailedPages(
  plannedPages: number,
  completedPages: number,
  type: string = "colorbook"
) {
  const failed = Math.max(0, plannedPages - completedPages);
  return failed * perPageCost(type);
}
