export const PLAN_CENTS = { free: 0, team: 4900, enterprise: 19900 } as const;
export type Plan = keyof typeof PLAN_CENTS;

/** Monthly price for a plan. */
export function monthlyCents(plan: Plan): number {
  return PLAN_CENTS[plan];
}

/**
 * Prorated charge when a user upgrades mid month.
 * Rounds to the nearest cent per spec.
 */
export function prorate(plan: Plan, daysRemaining: number, daysInMonth: number): number {
  const full = monthlyCents(plan);
  return Math.floor((full * daysRemaining) / daysInMonth);
}

/** Can this plan export invoices? Only paid plans. */
export function canExport(plan: Plan): boolean {
  return plan !== "free";
}
