import { sign } from "./auth.mjs";
import { send, layout, button, esc } from "./mail.mjs";
import { playerById, scoreText, standings, RULES } from "./league.mjs";

const name = (state, id) => playerById(state, id)?.name || id;
const email = (state, id) => playerById(state, id)?.email || "";
const allEmails = (state, exclude = []) =>
  state.players.filter((p) => p.email && !exclude.includes(p.id)).map((p) => p.email);
const venueOf = (m) => (m.venue === "Otra" ? m.venueOther || "otra pista" : m.venue);

async function actLink(state, matchId, playerId, action) {
  const t = await sign({ t: "act", m: matchId, p: playerId, a: action }, 60 * 60 * 24 * 10);
  return `${state.baseUrl}/api/act?t=${encodeURIComponent(t)}`;
}

function matchBox(state, m) {
  const photo = m.photo ? `<p style="margin:8px 0 0;color:#6b6f66;font-size:13px">Hay foto del partido en la web.</p>` : "";
  return `<div style="font-size:18px;font-weight:700;margin-bottom:4px">${esc(name(state, m.winner))} gana a ${esc(name(state, m.loser))}</div>
<div style="font-size:24px;font-weight:800;letter-spacing:.02em;margin:6px 0">${esc(scoreText(m.sets))}${m.incomplete ? " <span style='font-size:13px;color:#b4532a'>(sin terminar)</span>" : ""}</div>
<div style="color:#6b6f66">${esc(venueOf(m))}${m.playedOn ? " · " + esc(m.playedOn) : ""}</div>${photo}`;
}

export async function notifyConfirmRequest(state, m) {
  const other = m.reportedBy === m.winner ? m.loser : m.winner;
  const reporter = name(state, m.reportedBy);
  let subject;
  if (m.incomplete) subject = `${reporter} ha apuntado un partido sin terminar contra ti, confírmalo`;
  else if (other === m.loser) subject = `Has perdido contra ${reporter}, confirma el resultado, por favor`;
  else subject = `Has ganado a ${reporter}, confirma el resultado`;
  const inner = `${matchBox(state, m)}
<p style="margin:16px 0 8px">${esc(reporter)} lo ha apuntado. ¿Es correcto?</p>
${button(await actLink(state, m.id, other, "confirm"), "Confirmar resultado")}
${button(await actLink(state, m.id, other, "reject"), "No es así", "#9a3b1f")}
<p style="font-size:13px;color:#6b6f66;margin-top:14px">Si no respondes en ${RULES.autoConfirmHours} horas se da por confirmado.</p>`;
  return send(email(state, other), subject, layout(subject, inner, state.baseUrl));
}

export async function notifyConfirmed(state, m) {
  const W = name(state, m.winner).toUpperCase();
  const L = name(state, m.loser).toUpperCase();
  const subject = `${W} HA GANADO A ${L} ${scoreText(m.sets)} EN ${venueOf(m).toUpperCase()}`;
  const d = m.deltas || {};
  const how = { auto: "Confirmado automáticamente a las 48 h.", votacion: "Convalidado por votación.", admin: "Confirmado por el admin." }[m.confirmedHow] || "";
  const top = standings(state).slice(0, 3).map((r) => `${r.pos}. ${esc(r.name)} · ${r.pts} pts`).join("<br>");
  const inner = `${matchBox(state, m)}
<p style="margin:14px 0 0"><b>${esc(name(state, m.winner))}</b> +${d.winner} pts${d.above ? ` (ha ganado a alguien de arriba, +${d.bonus} extra)` : ""}<br>
<b>${esc(name(state, m.loser))}</b> ${d.loser >= 0 ? "+" : ""}${d.loser} pts</p>
${how ? `<p style="color:#6b6f66;font-size:13px">${how}</p>` : ""}
<p style="margin:14px 0 0"><b>Puestos de cena</b><br>${top}</p>`;
  return send(allEmails(state), subject, layout(subject, inner, state.baseUrl));
}

export async function notifyRejected(state, m, byId, reason) {
  const subject = `${name(state, byId)} no está de acuerdo con el resultado contra ${name(state, byId === m.winner ? m.loser : m.winner)}`;
  const admins = state.players.filter((p) => p.admin).map((p) => p.id);
  const to = [...new Set([m.reportedBy, ...admins])].map((id) => email(state, id));
  const inner = `${matchBox(state, m)}${reason ? `<p style="margin-top:14px"><b>Motivo:</b> ${esc(reason)}</p>` : ""}
<p style="margin-top:14px">El partido queda en disputa y no puntúa. Hablad entre vosotros o que lo resuelva el admin desde la web.</p>`;
  return send(to, subject, layout(subject, inner, state.baseUrl));
}

export async function notifyVote(state, m) {
  const voters = state.players.filter((p) => p.id !== m.winner && p.id !== m.loser && p.email);
  const subject = `Votación: ¿convalidamos el ${name(state, m.winner)} - ${name(state, m.loser)} sin terminar?`;
  await Promise.all(voters.map(async (p) => {
    const inner = `${matchBox(state, m)}
<p style="margin:16px 0 8px">El partido no se acabó y piden que lo convalidemos como victoria de <b>${esc(name(state, m.winner))}</b>. Decide la mayoría.</p>
${button(await actLink(state, m.id, p.id, "yes"), "Convalidar")}
${button(await actLink(state, m.id, p.id, "no"), "No convalidar", "#9a3b1f")}`;
    return send(p.email, subject, layout(subject, inner, state.baseUrl));
  }));
}

export async function notifyVoteFailed(state, m) {
  const subject = `No se convalida el ${name(state, m.winner)} - ${name(state, m.loser)}`;
  const inner = `${matchBox(state, m)}<p style="margin-top:14px">La mayoría ha votado que no. El partido no puntúa; podéis acabarlo otro día y apuntarlo de nuevo.</p>`;
  return send([email(state, m.winner), email(state, m.loser)], subject, layout(subject, inner, state.baseUrl));
}

export async function notifyChallenge(state, fromId, toId, msg) {
  const subject = `${name(state, fromId)} te reta a un partido`;
  const inner = `<p><b>${esc(name(state, fromId))}</b> quiere jugar contra ti.</p>${msg ? `<p style="background:#f4efe4;border-radius:10px;padding:10px 12px">“${esc(msg)}”</p>` : ""}
<p>Responde directamente a ${esc(name(state, fromId))} para cuadrar día y pista.</p>
${email(state, fromId) ? button(`mailto:${email(state, fromId)}`, `Responder a ${name(state, fromId)}`) : ""}`;
  return send(email(state, toId), subject, layout(subject, inner, state.baseUrl));
}

export async function notifyLogin(state, player, link) {
  const subject = "Tu enlace para entrar en la liguita";
  const inner = `<p>Hola ${esc(player.name)}, pulsa para entrar. El enlace caduca en 30 minutos.</p>${button(link, "Entrar en la web")}`;
  return send(player.email, subject, layout(subject, inner, null));
}

export async function weeklySummary(state) {
  const rows = standings(state);
  const week = Date.now() - 7 * 864e5;
  const recent = state.matches.filter((m) => m.status === "confirmed" && m.confirmedAt > week);
  const table = rows.map((r) => `<tr style="${r.pos <= 3 ? "background:#e3f0e6" : ""}"><td style="padding:6px 8px">${r.pos}</td><td style="padding:6px 8px">${esc(r.name)}</td><td style="padding:6px 8px;text-align:right"><b>${r.pts}</b></td><td style="padding:6px 8px;text-align:right;color:#6b6f66">${r.pj} PJ</td></tr>`).join("");
  const list = recent.length
    ? recent.map((m) => `${esc(name(state, m.winner))} gana a ${esc(name(state, m.loser))} ${esc(scoreText(m.sets))}`).join("<br>")
    : "Ningún partido esta semana. Alguien tendrá que retar a alguien.";
  const subject = `Resumen semanal: ${rows[0]?.name || ""} manda con ${rows[0]?.pts ?? 0} pts`;
  const inner = `<p style="margin-top:0"><b>Esta semana</b><br>${list}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:10px">${table}</table>
<p style="font-size:13px;color:#6b6f66">En verde, los que ahora mismo cenan gratis.</p>`;
  return send(allEmails(state), subject, layout(subject, inner, state.baseUrl));
}
