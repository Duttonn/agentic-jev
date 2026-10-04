import { login, validate } from "../auth/session.ts";
import { listInvoices, exportInvoices } from "./invoices.ts";

export interface Request {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}
export interface Response {
  status: number;
  body: unknown;
}

/** The router. Auth first, then the handler. */
export function handle(req: Request): Response {
  if (req.method === "POST" && req.path === "/login") {
    const token = login(String(req.body?.email ?? ""), String(req.body?.password ?? ""));
    return token ? { status: 200, body: { token } } : { status: 401, body: { error: "Wrong email or password" } };
  }
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const session = validate(token);
  if (!session) return { status: 401, body: { error: "Sign in required" } };

  if (req.method === "GET" && req.path === "/invoices") return listInvoices(session);
  if (req.method === "POST" && req.path === "/invoices/export") return exportInvoices(session);
  return { status: 404, body: { error: "Not found" } };
}
