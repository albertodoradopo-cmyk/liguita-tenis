// Lógica pura de la liga: puntos, clasificación y desempates.
// No depende de Netlify, así se puede probar con node directamente.

export const VENUES = ["El Polo", "Tenis BCN"];

export const RULES = {
  win: 10,            // victoria
  loss: 3,            // derrota (por jugar)
  abovePct: 0.10,     // % de los puntos del rival si está por encima
  participationMin: 7,
  participationMax: 15,
  participationBonus: 7,
  snitchPenalty: -5,  // el que se chiva
  cheatPenalty: -10,  // el que calla (además pierde lo que sumó)
  bagelBonus: 2,      // por cada set ganado 6-0 (o 7-0)
  autoConfirmHours: 48,
  voteHours: 72,
};

export const round1 = (x) => Math.round(x * 10) / 10;

export function seedPlayers() {
  const roster = [
    ["Puig", "puigmolinsguille@gmail.com"],
    ["Jordi", "jjane.salomon@gmail.com"],
    ["Alberto", "albertodoradopo@gmail.com"],
    ["Alfon", "alfonsobenavidesf@gmail.com"],
    ["Cucho", "cuchoborda@gmail.com"],
    ["Cacha", "luiscasalspich@gmail.com"],
    ["Barru", "ibarrutietasaez@gmail.com"],
    ["Erik", "erikroigcortasa@gmail.com"],
  ];
  return roster.map(([name, email]) => ({ id: name.toLowerCase(), name, email, admin: name === "Alberto" }));
}

export function emptyState() {
  return {
    version: 1,
    players: seedPlayers(),
    matches: [],
    ledger: [],
    season: { name: "Temporada 2026-27", closed: false, closedAt: null },
    lastWeekly: null,
    baseUrl: null,
  };
}

export function uid(prefix = "") {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function playerById(state, id) {
  return state.players.find((p) => p.id === id);
}

export function pointsOf(state) {
  const pts = {};
  for (const p of state.players) pts[p.id] = 0;
  for (const e of state.ledger) pts[e.playerId] = round1((pts[e.playerId] || 0) + e.pts);
  return pts;
}

// Sets acabados a 0 (6-0 o 7-0). Un set a medias tipo 3-0 no cuenta.
// sets en perspectiva del ganador del partido: [juegos ganador, juegos perdedor]
export function countBagels(sets) {
  let w = 0, l = 0;
  for (const [a, b] of sets || []) {
    if (b === 0 && a >= 6 && a <= 7) w++;
    else if (a === 0 && b >= 6 && b <= 7) l++;
  }
  return { w, l };
}

// Puntos que genera un partido según la clasificación del momento.
export function computeDeltas(state, winnerId, loserId, sets) {
  const pts = pointsOf(state);
  const wp = pts[winnerId] || 0;
  const lp = pts[loserId] || 0;
  const bg = countBagels(sets);
  const bagelW = bg.w * RULES.bagelBonus;
  const bagelL = bg.l * RULES.bagelBonus;
  const extra = { bagelsW: bg.w, bagelsL: bg.l, bagelW, bagelL };
  if (lp > wp) {
    const bonus = round1(lp * RULES.abovePct);
    return { above: true, bonus, ...extra, winner: round1(RULES.win + bonus + bagelW), loser: round1(RULES.loss - bonus + bagelL) };
  }
  return { above: false, bonus: 0, ...extra, winner: RULES.win + bagelW, loser: RULES.loss + bagelL };
}

export function isGamesWin(m) {
  return Boolean(m?.incomplete && m?.mode === "games");
}

export function scoreText(sets) {
  return (sets || []).map(([a, b]) => `${a}-${b}`).join(" ");
}

export function confirmMatch(state, match, { now = Date.now(), how = "rival" } = {}) {
  const d = computeDeltas(state, match.winner, match.loser, match.sets);
  match.status = "confirmed";
  match.confirmedAt = now;
  match.confirmedHow = how; // rival | auto | votacion | admin
  match.deltas = d;
  const w = playerById(state, match.winner)?.name;
  const l = playerById(state, match.loser)?.name;
  const how2 = isGamesWin(match) ? " por juegos" : "";
  const rosco = (n) => (n ? `, +${n * RULES.bagelBonus} por ${n === 1 ? "set" : n + " sets"} a 0` : "");
  state.ledger.push(
    { id: uid("l"), ts: now, playerId: match.winner, pts: d.winner, matchId: match.id,
      reason: (d.above ? `Victoria${how2} contra ${l} (de arriba: +10 y +${d.bonus}` : `Victoria${how2} contra ${l} (+10`) + rosco(d.bagelsW) + ")" },
    { id: uid("l"), ts: now, playerId: match.loser, pts: d.loser, matchId: match.id,
      reason: (d.above ? `Derrota contra ${w} (+3 y -${d.bonus} por perder siendo de arriba` : `Derrota contra ${w} (+3`) + rosco(d.bagelsL) + ")" },
  );
  return d;
}

// Partidos confirmados antes de que existiera el bonus por set a 0: les suma lo que les toca.
// Idempotente: solo toca partidos cuyas deltas no tienen todavía el campo de roscos.
export function backfillBagels(state, now = Date.now()) {
  let n = 0;
  for (const m of confirmedMatches(state)) {
    if (!m.deltas || m.deltas.bagelsW !== undefined) continue;
    const bg = countBagels(m.sets);
    const bagelW = bg.w * RULES.bagelBonus, bagelL = bg.l * RULES.bagelBonus;
    Object.assign(m.deltas, { bagelsW: bg.w, bagelsL: bg.l, bagelW, bagelL,
      winner: round1(m.deltas.winner + bagelW), loser: round1(m.deltas.loser + bagelL) });
    const vs = (id) => playerById(state, id)?.name;
    if (bagelW) { state.ledger.push({ id: uid("l"), ts: now, playerId: m.winner, pts: bagelW, matchId: m.id, reason: `Bonus por set a 0 contra ${vs(m.loser)} (${scoreText(m.sets)})` }); n++; }
    if (bagelL) { state.ledger.push({ id: uid("l"), ts: now, playerId: m.loser, pts: bagelL, matchId: m.id, reason: `Bonus por set a 0 contra ${vs(m.winner)} (${scoreText(m.sets)})` }); n++; }
  }
  return n;
}

// Anula un partido ya confirmado devolviendo los puntos que generó.
export function reverseMatch(state, match, reason, now = Date.now()) {
  if (match.status !== "confirmed" || !match.deltas) return;
  state.ledger.push(
    { id: uid("l"), ts: now, playerId: match.winner, pts: -match.deltas.winner, matchId: match.id, reason },
    { id: uid("l"), ts: now, playerId: match.loser, pts: -match.deltas.loser, matchId: match.id, reason },
  );
}

// Trampa: se anula el partido, el chivato pierde 5 y el que calla pierde lo sumado y 10 más.
export function applyCheat(state, match, snitchId, now = Date.now()) {
  if (match.status !== "confirmed") throw new Error("Solo se puede sancionar un partido confirmado");
  if (![match.winner, match.loser].includes(snitchId)) throw new Error("El chivato tiene que ser uno de los dos jugadores");
  const otherId = snitchId === match.winner ? match.loser : match.winner;
  reverseMatch(state, match, "Partido anulado por trampa", now);
  state.ledger.push(
    { id: uid("l"), ts: now, playerId: snitchId, pts: RULES.snitchPenalty, matchId: match.id, reason: "Sanción por trampa (se chivó)" },
    { id: uid("l"), ts: now, playerId: otherId, pts: RULES.cheatPenalty, matchId: match.id, reason: "Sanción por trampa (no dijo nada)" },
  );
  match.status = "annulled";
  match.annulReason = "trampa";
  match.annulledAt = now;
}

export function annulMatch(state, match, now = Date.now()) {
  reverseMatch(state, match, "Partido anulado por el admin", now);
  match.status = "annulled";
  match.annulReason = "admin";
  match.annulledAt = now;
}

export function closeSeason(state, now = Date.now()) {
  if (state.season.closed) throw new Error("La temporada ya está cerrada");
  const stats = basicStats(state);
  for (const p of state.players) {
    const pj = stats[p.id].pj;
    if (pj >= RULES.participationMin && pj <= RULES.participationMax) {
      state.ledger.push({ id: uid("l"), ts: now, playerId: p.id, pts: RULES.participationBonus,
        reason: `Bonus de participación (${pj} partidos)` });
    }
  }
  state.season.closed = true;
  state.season.closedAt = now;
}

export function confirmedMatches(state) {
  return state.matches.filter((m) => m.status === "confirmed");
}

export function basicStats(state) {
  const s = {};
  for (const p of state.players) {
    s[p.id] = { pj: 0, pg: 0, pp: 0, setsW: 0, setsL: 0, gamesW: 0, gamesL: 0, bagels: 0 };
  }
  for (const m of confirmedMatches(state)) {
    const w = s[m.winner], l = s[m.loser];
    if (!w || !l) continue;
    w.pj++; l.pj++; w.pg++; l.pp++;
    const bg = countBagels(m.sets);
    w.bagels += bg.w; l.bagels += bg.l;
    for (const [a, b] of m.sets || []) {
      // sets guardados desde la perspectiva del ganador
      if (a > b) { w.setsW++; l.setsL++; } else if (b > a) { w.setsL++; l.setsW++; }
      w.gamesW += a; w.gamesL += b; l.gamesW += b; l.gamesL += a;
    }
  }
  return s;
}

export function standings(state) {
  const pts = pointsOf(state);
  const st = basicStats(state);
  const rows = state.players.map((p) => {
    const x = st[p.id];
    const eligible = x.pj >= RULES.participationMin && x.pj <= RULES.participationMax;
    return {
      id: p.id, name: p.name, pts: pts[p.id] || 0, ...x,
      bonusPending: !state.season.closed && eligible,
      matchesToBonus: Math.max(0, RULES.participationMin - x.pj),
    };
  });

  const cm = confirmedMatches(state);
  rows.sort((a, b) => b.pts - a.pts);
  // Desempate cara a cara dentro de cada grupo empatado a puntos
  const out = [];
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].pts === rows[i].pts) j++;
    const group = rows.slice(i, j + 1);
    if (group.length > 1) {
      const ids = new Set(group.map((r) => r.id));
      const h2h = {};
      for (const r of group) h2h[r.id] = 0;
      for (const m of cm) if (ids.has(m.winner) && ids.has(m.loser)) h2h[m.winner]++;
      group.forEach((r) => (r.h2hWins = h2h[r.id]));
      group.sort((a, b) =>
        b.h2hWins - a.h2hWins ||
        (b.setsW - b.setsL) - (a.setsW - a.setsL) ||
        b.pg - a.pg ||
        a.name.localeCompare(b.name));
    }
    out.push(...group);
    i = j + 1;
  }
  let pos = 0;
  out.forEach((r, k) => { pos = k + 1; r.pos = pos; });
  return out;
}

// Convierte los sets que mete quien reporta (sus juegos / juegos del rival)
// a la perspectiva del ganador y valida.
export function normalizeReport({ reporterId, opponentId, result, sets, incomplete, mode }) {
  if (!reporterId || !opponentId || reporterId === opponentId) throw new Error("Rival no válido");
  if (!["win", "loss"].includes(result)) throw new Error("Indica si has ganado o perdido");
  const clean = (sets || [])
    .map(([a, b]) => [parseInt(a, 10), parseInt(b, 10)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (!clean.length) throw new Error("Pon al menos un set");
  clean.forEach(([a, b], i) => {
    if (a < 0 || b < 0 || a > 20 || b > 20) throw new Error("Resultado de set no válido");
    // En un partido sin terminar el último set puede quedarse empatado (ej. 3-3)
    const lastOpen = incomplete && i === clean.length - 1;
    if (a === b && !lastOpen) throw new Error("Un set no puede acabar empatado");
  });
  const winner = result === "win" ? reporterId : opponentId;
  const loser = result === "win" ? opponentId : reporterId;
  const winnerSets = result === "win" ? clean : clean.map(([a, b]) => [b, a]);
  if (incomplete && mode === "games") {
    const gw = winnerSets.reduce((t, [a]) => t + a, 0);
    const gl = winnerSets.reduce((t, [, b]) => t + b, 0);
    if (gw <= gl) throw new Error(`Para ganar por juegos el ganador tiene que llevar más juegos (ahora ${gw}-${gl})`);
  }
  if (!incomplete) {
    const sw = winnerSets.filter(([a, b]) => a > b).length;
    const sl = winnerSets.length - sw;
    if (sw <= sl) throw new Error("Con esos sets no cuadra quién ha ganado. Si el partido no se acabó, márcalo como sin terminar");
  }
  return { winner, loser, sets: winnerSets };
}
