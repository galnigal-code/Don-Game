// Points per place among the HUMANS of a race (bots do not score and do not take a place).
export const POINTS = [10, 7, 5, 3, 2, 1];

/** order: array of { token, finished: bool } best first. Returns Map token -> points (unfinished/left players get 0). */
export function awardPoints(order) {
  const out = new Map();
  order.forEach((p, i) => out.set(p.token, p.finished ? (POINTS[i] ?? 0) : 0));
  return out;
}

/** scores: Map token -> { name, color, points, wins, races }. Returns the table sorted for display. */
export function scoreTable(scores) {
  return [...scores.values()]
    .map((s) => ({ name: s.name, color: s.color, points: s.points, wins: s.wins, races: s.races }))
    .sort((a, b) => b.points - a.points || b.wins - a.wins || a.races - b.races || a.name.localeCompare(b.name));
}
