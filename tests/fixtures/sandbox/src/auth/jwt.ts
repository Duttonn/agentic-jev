import { createHmac, timingSafeEqual } from "node:crypto";

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** Sign a payload with the shared secret. HS256, no library. */
export function sign(payload: Record<string, unknown>, secret: string): string {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify(payload));
  const mac = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${mac}`;
}

/** Verify and decode. Returns null on a bad signature or a malformed token. */
export function verify(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, mac] = parts;
  const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
