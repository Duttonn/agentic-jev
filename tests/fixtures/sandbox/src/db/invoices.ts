export interface Invoice {
  id: string;
  userId: string;
  cents: number;
  issuedAt: string;
  paid: boolean;
}

const INVOICES: Invoice[] = [
  { id: "inv_100", userId: "u_1", cents: 4900, issuedAt: "2026-08-01", paid: true },
  { id: "inv_101", userId: "u_1", cents: 4900, issuedAt: "2026-09-01", paid: false },
  { id: "inv_102", userId: "u_2", cents: 0, issuedAt: "2026-09-01", paid: true },
];

export function invoicesForUser(userId: string): Invoice[] {
  return INVOICES.filter((i) => i.userId === userId);
}

export function markPaid(id: string): boolean {
  const inv = INVOICES.find((i) => i.id === id);
  if (!inv) return false;
  inv.paid = true;
  return true;
}
