export const CREDIT_COSTS = {
  colorbook_page: 2,
  storybook_page: 3,
  cover: 5,
  pdf_export: 1,
  regenerate_page: 2,
  regenerate_cover: 5,
} as const;

export const CREDIT_PACKS = [
  {
    id: "starter",
    name: "Découverte",
    credits: 50,
    priceEur: 499,
    description: "Parfait pour un premier livre",
    stripePriceEnv: "STRIPE_PRICE_STARTER",
  },
  {
    id: "creator",
    name: "Créateur",
    credits: 200,
    priceEur: 1499,
    description: "Pour créer plusieurs livres",
    popular: true,
    stripePriceEnv: "STRIPE_PRICE_CREATOR",
  },
  {
    id: "studio",
    name: "Studio",
    credits: 600,
    priceEur: 3999,
    description: "Pour les créateurs réguliers",
    stripePriceEnv: "STRIPE_PRICE_STUDIO",
  },
  {
    id: "pro",
    name: "Pro",
    credits: 1500,
    priceEur: 8999,
    description: "Production en volume",
    stripePriceEnv: "STRIPE_PRICE_PRO",
  },
] as const;

export const FREE_CREDITS_ON_SIGNUP = 30;

export function estimateBookCost(pageCount: number, type: string = "colorbook") {
  const perPage =
    type === "storybook" ? CREDIT_COSTS.storybook_page : CREDIT_COSTS.colorbook_page;
  return CREDIT_COSTS.cover + pageCount * perPage + CREDIT_COSTS.pdf_export;
}
