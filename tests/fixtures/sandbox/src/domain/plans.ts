import type { Plan } from "./billing.ts";

/** What each plan includes. The catalog the /plans endpoint returns and the gates the handlers check. */
export interface PlanSpec {
  id: Plan;
  name: string;
  monthlyCents: number;
  seatsIncluded: number;
  extraSeatCents: number;
  export: boolean;
  apiKeys: boolean;
  webhooks: boolean;
  audit: boolean;
  rateLimitPerMinute: number | null;
}

export const PLANS: PlanSpec[] = [
  { id: "free", name: "Free", monthlyCents: 0, seatsIncluded: 1, extraSeatCents: 0, export: false, apiKeys: false, webhooks: false, audit: false, rateLimitPerMinute: 60 },
  { id: "team", name: "Team", monthlyCents: 4900, seatsIncluded: 5, extraSeatCents: 900, export: true, apiKeys: true, webhooks: true, audit: false, rateLimitPerMinute: 600 },
  { id: "enterprise", name: "Enterprise", monthlyCents: 19900, seatsIncluded: 25, extraSeatCents: 700, export: true, apiKeys: true, webhooks: true, audit: true, rateLimitPerMinute: null },
];

/** Regional list prices, per plan, in the local currency's minor unit. Reviewed quarterly by finance. */
export interface RegionalPrice {
  region: string;
  currency: string;
  team: number;
  enterprise: number;
  taxIncluded: boolean;
}

export const REGIONAL_PRICES: RegionalPrice[] = [
  { region: "us", currency: "USD", team: 4900, enterprise: 19900, taxIncluded: false },
  { region: "ca", currency: "CAD", team: 6664, enterprise: 27064, taxIncluded: false },
  { region: "gb", currency: "GBP", team: 3871, enterprise: 15721, taxIncluded: true },
  { region: "de", currency: "EUR", team: 4508, enterprise: 18308, taxIncluded: true },
  { region: "fr", currency: "EUR", team: 4508, enterprise: 18308, taxIncluded: true },
  { region: "es", currency: "EUR", team: 4508, enterprise: 18308, taxIncluded: true },
  { region: "it", currency: "EUR", team: 4508, enterprise: 18308, taxIncluded: true },
  { region: "nl", currency: "EUR", team: 4508, enterprise: 18308, taxIncluded: true },
  { region: "se", currency: "SEK", team: 50960, enterprise: 206960, taxIncluded: true },
  { region: "no", currency: "NOK", team: 51940, enterprise: 210940, taxIncluded: true },
  { region: "dk", currency: "DKK", team: 33810, enterprise: 137310, taxIncluded: true },
  { region: "fi", currency: "EUR", team: 4508, enterprise: 18308, taxIncluded: true },
  { region: "ie", currency: "EUR", team: 4508, enterprise: 18308, taxIncluded: true },
  { region: "pt", currency: "EUR", team: 4508, enterprise: 18308, taxIncluded: true },
  { region: "at", currency: "EUR", team: 4508, enterprise: 18308, taxIncluded: true },
  { region: "ch", currency: "CHF", team: 4312, enterprise: 17512, taxIncluded: true },
  { region: "be", currency: "EUR", team: 4508, enterprise: 18308, taxIncluded: true },
  { region: "pl", currency: "PLN", team: 19110, enterprise: 77610, taxIncluded: true },
  { region: "cz", currency: "CZK", team: 113190, enterprise: 459690, taxIncluded: true },
  { region: "au", currency: "AUD", team: 7448, enterprise: 30248, taxIncluded: false },
  { region: "nz", currency: "NZD", team: 8036, enterprise: 32636, taxIncluded: false },
  { region: "jp", currency: "JPY", team: 730100, enterprise: 2965100, taxIncluded: false },
  { region: "kr", currency: "KRW", team: 6517000, enterprise: 26467000, taxIncluded: false },
  { region: "sg", currency: "SGD", team: 6566, enterprise: 26666, taxIncluded: false },
  { region: "in", currency: "INR", team: 407680, enterprise: 1655680, taxIncluded: false },
  { region: "br", currency: "BRL", team: 24353, enterprise: 98903, taxIncluded: false },
  { region: "mx", currency: "MXN", team: 83790, enterprise: 340290, taxIncluded: false },
  { region: "ar", currency: "ARS", team: 4263000, enterprise: 17313000, taxIncluded: false },
  { region: "cl", currency: "CLP", team: 4557000, enterprise: 18507000, taxIncluded: false },
  { region: "za", currency: "ZAR", team: 90160, enterprise: 366160, taxIncluded: false },
];

export function planSpec(id: Plan): PlanSpec {
  const spec = PLANS.find((p) => p.id === id);
  if (!spec) throw new Error(`Unknown plan ${id}`);
  return spec;
}

/** Local price for a region, falling back to US dollars. */
export function regionalPrice(region: string, plan: Exclude<Plan, "free">): { amount: number; currency: string } {
  const row = REGIONAL_PRICES.find((p) => p.region === region) ?? REGIONAL_PRICES[0];
  return { amount: row[plan], currency: row.currency };
}

/** Seats over the included count are billed monthly at the plan's extra seat price. */
export function seatOverageCents(id: Plan, seats: number): number {
  const spec = planSpec(id);
  return Math.max(0, seats - spec.seatsIncluded) * spec.extraSeatCents;
}
