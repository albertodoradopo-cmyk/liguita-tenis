import { mutate } from "../lib/store.mjs";
import { confirmMatch, RULES } from "../lib/league.mjs";
import { resolveVote, sendNotifications } from "../lib/flow.mjs";
import { weeklySummary } from "../lib/notify.mjs";

// Cada hora: autoconfirma partidos sin respuesta en 48 h, cierra votaciones de más de 72 h
// y los lunes por la mañana manda el resumen semanal.
export default async () => {
  const now = Date.now();
  const madridParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", weekday: "short", hour: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (t) => madridParts.find((p) => p.type === t)?.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const sendWeekly = part("weekday") === "Mon" && Number(part("hour")) >= 9;

  const { state, result } = await mutate((s) => {
    const out = [];
    if (!s.baseUrl) return out; // nadie ha usado la web aún
    for (const m of s.matches) {
      if (m.status === "pending" && now - m.createdAt > RULES.autoConfirmHours * 3600e3) {
        if (m.incomplete) {
          m.status = "vote"; m.voteStartedAt = now; m.votes = {};
          out.push(["vote", m.id]);
        } else {
          confirmMatch(s, m, { now, how: "auto" });
          out.push(["confirmed", m.id]);
        }
      } else if (m.status === "vote" && now - m.voteStartedAt > RULES.voteHours * 3600e3) {
        out.push(...resolveVote(s, m, now, true));
      }
    }
    if (sendWeekly && s.lastWeekly !== today) {
      s.lastWeekly = today;
      out.push(["weekly"]);
    }
    return out;
  });

  const weekly = result.some((r) => r[0] === "weekly");
  await sendNotifications(state, result.filter((r) => r[0] !== "weekly"));
  if (weekly) await weeklySummary(state);
};

export const config = { schedule: "7 * * * *" };
