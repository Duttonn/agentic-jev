import type { Session } from "../auth/session.ts";
import type { Response } from "./routes.ts";
import { invoicesForUser } from "../db/invoices.ts";
import { findUserById } from "../db/users.ts";
import { canExport } from "../domain/billing.ts";

export function listInvoices(session: Session): Response {
  return { status: 200, body: { invoices: invoicesForUser(session.userId) } };
}

/** CSV export. Free plans get a clear error instead of an empty file. */
export function exportInvoices(session: Session): Response {
  const user = findUserById(session.userId);
  if (!user) return { status: 404, body: { error: "User not found" } };
  if (!canExport(user.plan)) return { status: 402, body: { error: "Export is available on the Team plan" } };
  const rows = invoicesForUser(session.userId).map((i) => `${i.id},${i.issuedAt},${(i.cents / 100).toFixed(2)},${i.paid ? "paid" : "open"}`);
  return { status: 200, body: { csv: ["id,issued,amount,status", ...rows].join("\n") } };
}
