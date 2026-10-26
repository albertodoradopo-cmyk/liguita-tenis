import { createHmac, timingSafeEqual } from "node:crypto";
import { getSecret } from "./store.mjs";

export const COOKIE = "liga_session";

export async function sign(payload, ttlSeconds) {
  const secret = await getSecret();
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export async function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  const secret = await getSecret();
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(data, "base64url").toString());
    if (!body.exp || body.exp < Date.now() / 1000) return null;
    return body;
  } catch {
    return null;
  }
}

export async function sessionPlayer(context, state) {
  const token = context.cookies.get(COOKIE);
  const body = await verify(token);
  if (!body || body.t !== "session") return null;
  return state.players.find((p) => p.id === body.pid) || null;
}
