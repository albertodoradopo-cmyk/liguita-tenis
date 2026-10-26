import * as N from "./notify.mjs";
import { confirmMatch } from "./league.mjs";

export class HttpError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

// Aplica una acción sobre un partido. Devuelve la lista de avisos a enviar tras guardar.
export function applyAction(state, m, playerId, action, reason) {
  if (!m) throw new HttpError("Ese partido no existe", 404);
  const now = Date.now();
  const involved = [m.winner, m.loser];
  const notify = [];

  if (action === "confirm" || action === "reject") {
    const other = m.reportedBy === m.winner ? m.loser : m.winner;
    if (playerId !== other) throw new HttpError("Solo el rival puede confirmar o rechazar este partido", 403);
    if (m.status !== "pending") throw new HttpError(statusMsg(m), 409);
    if (action === "reject") {
      m.status = "rejected";
      m.rejectedAt = now;
      m.rejectReason = (reason || "").slice(0, 300);
      notify.push(["rejected", m.id, playerId, m.rejectReason]);
    } else if (m.incomplete) {
      m.status = "vote";
      m.voteStartedAt = now;
      m.votes = {};
      notify.push(["vote", m.id]);
    } else {
      confirmMatch(state, m, { now, how: "rival" });
      notify.push(["confirmed", m.id]);
    }
    return notify;
  }

  if (action === "yes" || action === "no") {
    if (involved.includes(playerId)) throw new HttpError("Los que jugaron no votan", 403);
    if (m.status !== "vote") throw new HttpError(statusMsg(m), 409);
    m.votes = m.votes || {};
    m.votes[playerId] = action === "yes";
    return resolveVote(state, m, now);
  }
  throw new HttpError("Acción no válida");
}

export function resolveVote(state, m, now = Date.now(), force = false) {
  const eligible = state.players.filter((p) => p.id !== m.winner && p.id !== m.loser).length;
  const needed = Math.floor(eligible / 2) + 1;
  const values = Object.values(m.votes || {});
  const yes = values.filter(Boolean).length;
  const no = values.length - yes;
  if (yes >= needed || (force && yes > no)) {
    confirmMatch(state, m, { now, how: "votacion" });
    return [["confirmed", m.id]];
  }
  if (no > eligible - needed || force) {
    m.status = "vote_failed";
    m.voteClosedAt = now;
    return [["voteFailed", m.id]];
  }
  return [];
}

export function statusMsg(m) {
  return {
    confirmed: "Este partido ya estaba confirmado",
    rejected: "Este partido ya se rechazó",
    annulled: "Este partido está anulado",
    vote: "Este partido está en votación",
    vote_failed: "La votación ya se cerró",
    cancelled: "Este partido se borró",
    postponed: "Este partido está aplazado",
  }[m.status] || "Este partido ya no admite cambios";
}

export async function sendNotifications(state, list) {
  for (const [kind, matchId, ...rest] of list) {
    const m = state.matches.find((x) => x.id === matchId);
    if (!m) continue;
    if (kind === "confirmed") await N.notifyConfirmed(state, m);
    if (kind === "rejected") await N.notifyRejected(state, m, rest[0], rest[1]);
    if (kind === "vote") await N.notifyVote(state, m);
    if (kind === "voteFailed") await N.notifyVoteFailed(state, m);
    if (kind === "request") await N.notifyConfirmRequest(state, m);
  }
}

