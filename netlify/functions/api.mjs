import { loadState, mutate, photoStore } from "../lib/store.mjs";
import { sign, verify, sessionPlayer, COOKIE } from "../lib/auth.mjs";
import { mailConfigured, send, layout, esc } from "../lib/mail.mjs";
import * as N from "../lib/notify.mjs";
import { HttpError, applyAction, statusMsg, sendNotifications } from "../lib/flow.mjs";
import {
  standings, normalizeReport, confirmMatch, applyCheat, annulMatch, closeSeason,
  playerById, uid, round1, scoreText, VENUES, RULES,
} from "../lib/league.mjs";

const json = (data, status = 200) => Response.json(data, { status });
const fail = (msg, status = 400) => json({ error: msg }, status);
const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

function publicState(state, me) {
  return {
    players: state.players.map((p) => ({ id: p.id, name: p.name, admin: !!p.admin, ...(me?.admin ? { email: p.email } : {}) })),
    matches: state.matches,
    ledger: state.ledger,
    season: state.season,
    standings: standings(state),
    rules: RULES,
    venues: VENUES,
    me: me ? { id: me.id, name: me.name, admin: !!me.admin } : null,
    mailReady: mailConfigured(),
  };
}

function actPage(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{margin:0;background:#f4efe4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2420}
.w{max-width:480px;margin:0 auto;padding:32px 16px}.k{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#b4532a;font-weight:700}
h1{font-size:22px;margin:8px 0 16px}.c{background:#fffdf8;border:1px solid #e3dccb;border-radius:14px;padding:18px;line-height:1.5}
.s{font-size:26px;font-weight:800;margin:6px 0}button,a.b{display:inline-block;border:0;background:#1f4d3a;color:#fff;font-size:16px;font-weight:600;padding:13px 20px;border-radius:10px;margin-top:12px;cursor:pointer;text-decoration:none}
button.r{background:#9a3b1f}textarea{width:100%;box-sizing:border-box;border:1px solid #d9d1bd;border-radius:10px;padding:10px;font:inherit;margin-top:10px;min-height:70px}
</style></head><body><div class="w"><div class="k">Liguita de tenis</div><h1>${esc(title)}</h1><div class="c">${body}</div></div></body></html>`;
}

async function handleAct(req, origin) {
  if (req.method === "GET") {
    const t = new URL(req.url).searchParams.get("t");
    const tok = await verify(t);
    if (!tok || tok.t !== "act") return html(actPage("Enlace caducado", `<p>Este enlace ya no vale. Entra en la web para ver el partido.</p><a class="b" href="/">Ir a la web</a>`), 400);
    const { state } = await loadState();
    const m = state.matches.find((x) => x.id === tok.m);
    if (!m) return html(actPage("Partido no encontrado", `<a class="b" href="/">Ir a la web</a>`), 404);
    const W = playerById(state, m.winner)?.name, L = playerById(state, m.loser)?.name;
    const done = (tok.a === "confirm" || tok.a === "reject") ? m.status !== "pending" : m.status !== "vote";
    const head = `<div><b>${esc(W)}</b> gana a <b>${esc(L)}</b></div><div class="s">${esc(scoreText(m.sets))}</div><div>${esc(m.venue === "Otra" ? m.venueOther : m.venue)}</div>`;
    if (done) return html(actPage(statusMsg(m), `${head}<a class="b" href="/">Ver clasificación</a>`));
    const labels = { confirm: ["¿Confirmas el resultado?", "Sí, confirmar", ""], reject: ["¿Rechazar el resultado?", "Rechazar", "r"], yes: ["¿Convalidar el partido?", "Sí, convalidar", ""], no: ["¿No convalidar?", "No convalidar", "r"] };
    const [title, label, cls] = labels[tok.a] || labels.confirm;
    const extra = tok.a === "reject" ? `<textarea name="reason" placeholder="Qué ha pasado (opcional)"></textarea>` : "";
    return html(actPage(title, `${head}<form method="post" action="/api/act"><input type="hidden" name="t" value="${esc(t)}">${extra}<button class="${cls}" type="submit">${esc(label)}</button></form>`));
  }

  const form = await req.formData();
  const tok = await verify(form.get("t"));
  if (!tok || tok.t !== "act") return html(actPage("Enlace caducado", `<a class="b" href="/">Ir a la web</a>`), 400);
  try {
    const { state, result } = await mutate((s) => {
      s.baseUrl = origin;
      const m = s.matches.find((x) => x.id === tok.m);
      return applyAction(s, m, tok.p, tok.a, form.get("reason"));
    });
    await sendNotifications(state, result);
    const msg = { confirm: "Resultado confirmado. Clasificación actualizada.", reject: "Rechazado. Le hemos avisado.", yes: "Voto registrado.", no: "Voto registrado." }[tok.a];
    return html(actPage("Hecho", `<p>${msg}</p><a class="b" href="/">Ver clasificación</a>`));
  } catch (e) {
    return html(actPage("No se ha podido", `<p>${esc(e.message)}</p><a class="b" href="/">Ir a la web</a>`), e.status || 400);
  }
}

async function readBody(req) {
  const type = req.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) return { form: await req.formData() };
  try { return { body: await req.json() }; } catch { return { body: {} }; }
}

export default async (req, context) => {
  const url = new URL(req.url);
  const origin = url.origin;
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const parts = path.split("/");

  try {
    if (path === "act") return await handleAct(req, origin);

    if (path === "state" && req.method === "GET") {
      const { state } = await loadState();
      const me = await sessionPlayer(context, state);
      return json(publicState(state, me));
    }

    if (path === "login" && req.method === "POST") {
      const { body } = await readBody(req);
      const em = String(body.email || "").trim().toLowerCase();
      const { state } = await loadState();
      const p = state.players.find((x) => x.email && x.email.toLowerCase() === em);
      if (!p) return fail("Ese correo no está en la liga. Pídele al admin que te lo añada.", 404);
      if (!mailConfigured()) return fail("El envío de correos aún no está configurado.", 503);
      const t = await sign({ t: "login", pid: p.id }, 30 * 60);
      await N.notifyLogin({ ...state, baseUrl: origin }, p, `${origin}/api/auth?t=${encodeURIComponent(t)}`);
      return json({ ok: true });
    }

    if (path === "auth" && req.method === "GET") {
      const tok = await verify(url.searchParams.get("t"));
      if (!tok || tok.t !== "login") return html(actPage("Enlace caducado", `<p>Pide otro desde la web.</p><a class="b" href="/">Ir a la web</a>`), 400);
      const session = await sign({ t: "session", pid: tok.pid }, 60 * 60 * 24 * 180);
      context.cookies.set({ name: COOKIE, value: session, path: "/", httpOnly: true, secure: true, sameSite: "Lax", expires: new Date(Date.now() + 180 * 864e5) });
      return new Response(null, { status: 302, headers: { Location: "/?entrado=1" } });
    }

    if (path === "logout" && req.method === "POST") {
      context.cookies.delete({ name: COOKIE, path: "/" });
      return json({ ok: true });
    }

    if (parts[0] === "photo" && parts[1] && req.method === "GET") {
      const res = await photoStore().getWithMetadata(parts[1], { type: "arrayBuffer" });
      if (!res) return new Response("No hay foto", { status: 404 });
      return new Response(res.data, { headers: { "content-type": res.metadata?.type || "image/jpeg", "cache-control": "private, max-age=86400" } });
    }

    // A partir de aquí hay que estar dentro
    const { state: current } = await loadState();
    const me = await sessionPlayer(context, current);
    if (!me) return fail("Tienes que entrar con tu correo", 401);

    if (path === "report" && req.method === "POST") {
      const { form, body } = await readBody(req);
      const get = (k) => (form ? form.get(k) : body[k]);
      const sets = JSON.parse(get("sets") || "[]");
      const incomplete = get("incomplete") === "true" || get("incomplete") === true;
      const mode = incomplete ? (get("mode") === "postpone" ? "postpone" : "vote") : null;
      const venue = String(get("venue") || "");
      const venueOther = String(get("venueOther") || "").trim().slice(0, 60);
      if (![...VENUES, "Otra"].includes(venue)) throw new HttpError("Elige dónde se ha jugado");
      if (venue === "Otra" && !venueOther) throw new HttpError("Escribe el nombre de la pista");
      const norm = normalizeReport({ reporterId: me.id, opponentId: get("opponent"), result: get("result"), sets, incomplete });
      if (!playerById(current, norm.winner) || !playerById(current, norm.loser)) throw new HttpError("Rival no válido");
      const playedOn = String(get("playedOn") || "").slice(0, 10);
      const id = uid("m");

      const photo = form?.get("photo");
      let hasPhoto = false;
      if (photo && typeof photo === "object" && photo.size > 0) {
        if (photo.size > 4.5 * 1024 * 1024) throw new HttpError("La foto pesa demasiado");
        await photoStore().set(id, await photo.arrayBuffer(), { metadata: { type: photo.type || "image/jpeg" } });
        hasPhoto = true;
      }

      const { state, result } = await mutate((s) => {
        s.baseUrl = origin;
        const m = {
          id, createdAt: Date.now(), reportedBy: me.id, ...norm, venue, venueOther: venue === "Otra" ? venueOther : "",
          playedOn, photo: hasPhoto, incomplete, mode, status: mode === "postpone" ? "postponed" : "pending",
          note: String(get("note") || "").slice(0, 200),
        };
        s.matches.push(m);
        return mode === "postpone" ? [] : [["request", id]];
      });
      await sendNotifications(state, result);
      return json({ ok: true, id, state: publicState(state, me) });
    }

    if (parts[0] === "match" && parts[1] && req.method === "POST") {
      const { body } = await readBody(req);
      const op = parts[2];
      const { state, result } = await mutate((s) => {
        s.baseUrl = origin;
        const m = s.matches.find((x) => x.id === parts[1]);
        if (!m) throw new HttpError("Ese partido no existe", 404);
        if (op === "respond") return applyAction(s, m, me.id, body.action, body.reason);
        if (op === "cancel") {
          if (m.reportedBy !== me.id && !me.admin) throw new HttpError("Solo quien lo apuntó puede borrarlo", 403);
          if (!["pending", "postponed", "rejected"].includes(m.status)) throw new HttpError("Ya no se puede borrar", 409);
          m.status = "cancelled";
          return [];
        }
        if (op === "request-vote") {
          // Un aplazado que al final quieren convalidar
          if (![m.winner, m.loser].includes(me.id)) throw new HttpError("No jugaste este partido", 403);
          if (m.status !== "postponed") throw new HttpError(statusMsg(m), 409);
          m.mode = "vote"; m.status = "pending"; m.reportedBy = me.id;
          return [["request", m.id]];
        }
        throw new HttpError("Acción no válida");
      });
      await sendNotifications(state, result);
      return json({ ok: true, state: publicState(state, me) });
    }

    if (path === "challenge" && req.method === "POST") {
      const { body } = await readBody(req);
      const target = playerById(current, body.opponent);
      if (!target || target.id === me.id) throw new HttpError("Rival no válido");
      if (!target.email) throw new HttpError(`${target.name} todavía no tiene correo en la liga`);
      const r = await N.notifyChallenge({ ...current, baseUrl: origin }, me.id, target.id, String(body.message || "").slice(0, 300));
      if (r.skipped) throw new HttpError("No se ha podido enviar: " + r.skipped);
      return json({ ok: true });
    }

    if (path === "admin" && req.method === "POST") {
      if (!me.admin) return fail("Solo para el admin", 403);
      const { body } = await readBody(req);
      if (body.op === "testMail") {
        const r = await send(me.email, "Prueba de correo de la liguita", layout("Funciona", "<p>Si lees esto, los correos de la liga ya salen bien.</p>", origin));
        if (!r.ok) throw new HttpError("No ha salido: " + (r.skipped || r.error));
        return json({ ok: true });
      }
      const { state, result } = await mutate((s) => {
        s.baseUrl = origin;
        const m = body.matchId ? s.matches.find((x) => x.id === body.matchId) : null;
        switch (body.op) {
          case "savePlayers": {
            const incoming = Array.isArray(body.players) ? body.players : [];
            const seen = new Set();
            const next = [];
            for (const p of incoming) {
              const nm = String(p.name || "").trim().slice(0, 30);
              if (!nm) continue;
              let id = p.id || nm.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "") || uid("p");
              while (seen.has(id) || (!p.id && s.players.some((x) => x.id === id))) id += "x";
              seen.add(id);
              next.push({ id, name: nm, email: String(p.email || "").trim().toLowerCase(), admin: !!p.admin });
            }
            if (!next.some((p) => p.admin)) throw new HttpError("Tiene que quedar al menos un admin");
            const used = new Set(s.matches.flatMap((x) => [x.winner, x.loser]));
            for (const old of s.players) if (!seen.has(old.id) && used.has(old.id)) throw new HttpError(`No puedes borrar a ${old.name}, ya tiene partidos`);
            s.players = next;
            return [];
          }
          case "annul": if (!m) throw new HttpError("Partido no encontrado"); annulMatch(s, m); return [];
          case "cheat": if (!m) throw new HttpError("Partido no encontrado"); applyCheat(s, m, body.snitchId); return [];
          case "forceConfirm":
            if (!m) throw new HttpError("Partido no encontrado");
            if (!["pending", "rejected", "vote", "vote_failed"].includes(m.status)) throw new HttpError(statusMsg(m));
            confirmMatch(s, m, { how: "admin" });
            return [["confirmed", m.id]];
          case "adjust": {
            const pts = round1(Number(body.pts));
            if (!playerById(s, body.playerId) || !Number.isFinite(pts) || pts === 0) throw new HttpError("Ajuste no válido");
            s.ledger.push({ id: uid("l"), ts: Date.now(), playerId: body.playerId, pts, reason: String(body.reason || "Ajuste del admin").slice(0, 120) });
            return [];
          }
          case "closeSeason": closeSeason(s); return [];
          case "renameSeason": s.season.name = String(body.name || s.season.name).slice(0, 60); return [];
          case "weekly": return [["weekly"]];
          default: throw new HttpError("Operación desconocida");
        }
      });
      if (result[0]?.[0] === "weekly") await N.weeklySummary(state);
      else await sendNotifications(state, result);
      return json({ ok: true, state: publicState(state, me) });
    }

    return fail("No encontrado", 404);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status);
    if (e?.message && !e.stack?.includes("node_modules")) {
      console.error(e);
      return fail(e.message, 400);
    }
    console.error(e);
    return fail("Error interno", 500);
  }
};

export const config = { path: "/api/*" };
