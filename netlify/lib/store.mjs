import { getStore } from "@netlify/blobs";
import { emptyState } from "./league.mjs";

const KEY = "state";

export function ligaStore() {
  return getStore({ name: "liga", consistency: "strong" });
}
export function photoStore() {
  return getStore({ name: "fotos", consistency: "strong" });
}

export async function loadState() {
  const store = ligaStore();
  const res = await store.getWithMetadata(KEY, { type: "json" });
  if (!res || !res.data) return { state: emptyState(), etag: null };
  return { state: res.data, etag: res.etag };
}

// Lee, modifica y guarda con control de versión (reintenta si alguien escribió a la vez).
export async function mutate(fn) {
  const store = ligaStore();
  for (let attempt = 0; attempt < 6; attempt++) {
    const { state, etag } = await loadState();
    const result = await fn(state);
    const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const { modified } = await store.setJSON(KEY, state, opts);
    if (modified) return { state, result };
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 300));
  }
  throw new Error("Demasiadas escrituras a la vez, vuelve a intentarlo");
}

export async function getSecret() {
  const store = ligaStore();
  let s = await store.get("secret");
  if (s) return s;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const fresh = Buffer.from(bytes).toString("base64url");
  await store.set("secret", fresh, { onlyIfNew: true });
  return (await store.get("secret")) || fresh;
}
