import { sign, verify } from "./jwt.ts";
import { findUserByEmail } from "../db/users.ts";

const SECRET = process.env.SESSION_SECRET ?? "dev-secret-change-me";
const TTL_SECONDS = 60 * 60 * 8;

export interface Session {
  userId: string;
  email: string;
  expiresAt: number;
}

/** Issue a session token for a known user. Rotates on every login. */
export function login(email: string, password: string): string | null {
  const user = findUserByEmail(email);
  if (!user || user.password !== password) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return sign({ sub: user.id, email: user.email, exp: expiresAt }, SECRET);
}

/** Validate a token. Expired or forged tokens return null. */
export function validate(token: string): Session | null {
  const claims = verify(token, SECRET);
  if (!claims) return null;
  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  return { userId: String(claims.sub), email: String(claims.email), expiresAt: exp };
}
