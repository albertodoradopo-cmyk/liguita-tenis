import assert from "node:assert/strict";
import * as L from "../netlify/lib/league.mjs";

const s = L.emptyState();
const add = (w, l, sets = [[6, 3], [6, 3]]) => {
  const m = { id: L.uid("m"), winner: w, loser: l, sets, status: "pending" };
  s.matches.push(m);
  return [m, L.confirmMatch(s, m)];
};

// 1. Todos a 0: nadie está por encima
let [m1, d1] = add("jordi", "alberto");
assert.deepEqual([d1.winner, d1.loser, d1.above], [10, 3, false]);

// 2. Alberto (3) gana a Jordi (10): Jordi está por encima -> 10 + 1 = 11; Jordi 3 - 1 = 2
let [m2, d2] = add("alberto", "jordi");
assert.deepEqual([d2.winner, d2.loser, d2.above], [11, 2, true]);
let p = L.pointsOf(s);
assert.equal(p.alberto, 14);
assert.equal(p.jordi, 12);

// 3. Ganar a alguien de abajo: 10 / 3
let [, d3] = add("alberto", "puig");
assert.deepEqual([d3.winner, d3.loser], [10, 3]);

// 4. Trampa en m3: Puig se chiva. Alberto pierde los 10 y 10 más; Puig pierde sus 3 y 5 más
const before = L.pointsOf(s);
L.applyCheat(s, s.matches[2], "puig");
p = L.pointsOf(s);
assert.equal(p.alberto, before.alberto - 10 - 10);
assert.equal(p.puig, before.puig - 3 - 5);
assert.equal(s.matches[2].status, "annulled");

// 5. Desempate cara a cara: Cucho y Cacha empatados, Cacha ganó el cara a cara
const t = L.emptyState();
const conf = (w, l) => { const m = { id: L.uid(), winner: w, loser: l, sets: [[6, 0]], status: "p" }; t.matches.push(m); L.confirmMatch(t, m); };
conf("cacha", "cucho");      // cacha 10, cucho 3
t.ledger.push({ id: "adj", ts: 1, playerId: "cucho", pts: 7, reason: "ajuste" }); // cucho 10
const st = L.standings(t);
const ids = st.map((r) => r.id);
assert.equal(L.pointsOf(t).cucho, 10);
assert.ok(ids.indexOf("cacha") < ids.indexOf("cucho"), "cacha por delante por cara a cara");

// 6. Bonus de participación al cierre
const u = L.emptyState();
for (let i = 0; i < 7; i++) { const m = { id: L.uid(), winner: "erik", loser: "barru", sets: [[6, 1]], status: "p" }; u.matches.push(m); L.confirmMatch(u, m); }
const preE = L.pointsOf(u).erik;
assert.equal(L.standings(u).find(r=>r.id==="erik").bonusPending, true);
L.closeSeason(u);
assert.equal(L.pointsOf(u).erik, preE + 7);
assert.equal(L.pointsOf(u).puig, 0);

// 7. Normalizar reporte del que pierde
const r = L.normalizeReport({ reporterId: "guille", opponentId: "jordi", result: "loss", sets: [[3, 6], [3, 6]] });
assert.deepEqual(r, { winner: "jordi", loser: "guille", sets: [[6, 3], [6, 3]] });
assert.throws(() => L.normalizeReport({ reporterId: "a", opponentId: "b", result: "win", sets: [[3, 6], [3, 6]] }));
assert.doesNotThrow(() => L.normalizeReport({ reporterId: "a", opponentId: "b", result: "win", sets: [[4, 2]], incomplete: true }));

console.log("OK: todas las reglas pasan");

// 8. Bonus por set a 0: 6-0 6-3 -> ganador +2
{
  const v = L.emptyState();
  const m = { id: "b1", winner: "jordi", loser: "puig", sets: [[6, 0], [6, 3]], status: "p" };
  v.matches.push(m); const d = L.confirmMatch(v, m);
  assert.deepEqual([d.winner, d.loser, d.bagelsW], [12, 3, 1]);
  // el perdedor gana un set 0-6: también suma
  const m2 = { id: "b2", winner: "cucho", loser: "erik", sets: [[0, 6], [6, 4], [10, 8]], status: "p" };
  v.matches.push(m2); const d2 = L.confirmMatch(v, m2);
  assert.deepEqual([d2.winner, d2.loser], [10, 5]);
  // 7-0 (no debería pasar, pero cuenta) y 3-0 a medias no
  assert.deepEqual(L.countBagels([[6, 0], [0, 6], [3, 0], [7, 0]]), { w: 2, l: 1 });
  // anular devuelve también el bonus
  const before = L.pointsOf(v).jordi;
  L.annulMatch(v, m);
  assert.equal(L.pointsOf(v).jordi, before - 12);
  assert.equal(L.standings(v).find((r) => r.id === "erik").bagels, 1);
}

// 9. Ganado por juegos: 6-3 3-1 vale; 3-6 4-1 (7-7) no
{
  const ok = L.normalizeReport({ reporterId: "alfon", opponentId: "cucho", result: "win", sets: [[6, 3], [3, 1]], incomplete: true, mode: "games" });
  assert.equal(ok.winner, "alfon");
  assert.throws(() => L.normalizeReport({ reporterId: "alfon", opponentId: "cucho", result: "win", sets: [[3, 6], [4, 1]], incomplete: true, mode: "games" }), /más juegos/);
  // set a medias empatado permitido solo si está sin terminar y es el último
  assert.doesNotThrow(() => L.normalizeReport({ reporterId: "a", opponentId: "b", result: "win", sets: [[6, 2], [3, 3]], incomplete: true, mode: "games" }));
  assert.throws(() => L.normalizeReport({ reporterId: "a", opponentId: "b", result: "win", sets: [[3, 3], [6, 2]], incomplete: true, mode: "games" }));
}

// 10. Por juegos vale 7 (+10% si el rival está arriba)
{
  const v = L.emptyState();
  const g = { id: "g1", winner: "erik", loser: "alfon", sets: [[6, 2], [3, 1]], incomplete: true, mode: "games", status: "p" };
  v.matches.push(g); const d = L.confirmMatch(v, g);
  assert.deepEqual([d.winner, d.loser], [7, 3]);
}

// 11. Recálculo de una liga ya jugada con reglas viejas (por juegos a 10, sin bonus de 6-0)
{
  const v = L.emptyState();
  const mk = (id, w, l, sets, t, extra = {}) => ({ id, winner: w, loser: l, sets, status: "confirmed", confirmedAt: t, createdAt: t, confirmedHow: "rival", ...extra });
  const m1 = mk("a", "alfon", "cucho", [[6, 0], [6, 2]], 100);
  const m2 = mk("b", "erik", "alfon", [[6, 3], [3, 1]], 200, { incomplete: true, mode: "games" });
  const m3 = mk("c", "puig", "jordi", [[6, 1], [6, 1]], 300, { status: "annulled", annulReason: "trampa" });
  v.matches.push(m1, m2, m3);
  // ledger tal como lo dejó la versión vieja
  v.ledger.push(
    { id: "1", ts: 100, playerId: "alfon", pts: 10, matchId: "a", reason: "Victoria" }, { id: "2", ts: 100, playerId: "cucho", pts: 3, matchId: "a", reason: "Derrota" },
    { id: "3", ts: 200, playerId: "erik", pts: 11, matchId: "b", reason: "Victoria" }, { id: "4", ts: 200, playerId: "alfon", pts: 2, matchId: "b", reason: "Derrota" },
    { id: "5", ts: 300, playerId: "puig", pts: 10, matchId: "c", reason: "Victoria" }, { id: "6", ts: 300, playerId: "jordi", pts: 3, matchId: "c", reason: "Derrota" },
    { id: "7", ts: 400, playerId: "puig", pts: -10, matchId: "c", reason: "Partido anulado por trampa" }, { id: "8", ts: 400, playerId: "jordi", pts: -3, matchId: "c", reason: "Partido anulado por trampa" },
    { id: "9", ts: 400, playerId: "jordi", pts: -5, matchId: "c", reason: "Sanción por trampa (se chivó)" }, { id: "10", ts: 400, playerId: "puig", pts: -10, matchId: "c", reason: "Sanción por trampa (no dijo nada)" },
    { id: "11", ts: 500, playerId: "barru", pts: 4, reason: "Ajuste del admin" },
  );
  delete v.rulesVersion;
  const diff = L.recalculate(v);
  const p = L.pointsOf(v);
  // Alfon: 10 + 2 (6-0) = 12; luego pierde contra Erik estando arriba: 3 - 1.2 = 1.8 -> 13.8
  assert.equal(p.alfon, 13.8);
  // Erik: 7 + 1.2 = 8.2 (antes 11)
  assert.equal(p.erik, 8.2);
  assert.equal(diff.erik, -2.8);
  assert.equal(p.cucho, 3);
  assert.equal(p.puig, -10); assert.equal(p.jordi, -5); assert.equal(p.barru, 4);
  assert.equal(v.rulesVersion, L.RULES_VERSION);
  // idempotente
  L.recalculate(v); assert.deepEqual(L.pointsOf(v), p);
}
console.log("OK: reglas nuevas (set a 0, por juegos, backfill)");
