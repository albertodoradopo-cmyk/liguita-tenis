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
