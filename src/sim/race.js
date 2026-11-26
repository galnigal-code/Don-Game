// Live ranking: finished cars first (by finish time), then cars still racing (by distance),
// then cars the roller flattened (the one flattened LATER ranks higher).
export function computeRanks(cars) {
  const group = (c) => (c.finishTime != null ? 0 : c.state === 'eliminated' ? 2 : 1);
  const sorted = [...cars].sort((a, b) => {
    const ga = group(a), gb = group(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0) return a.finishTime - b.finishTime;
    if (ga === 2) return b.eliminatedAt - a.eliminatedAt;
    return b.s - a.s;
  });
  sorted.forEach((c, i) => { c.rank = i + 1; });
  return sorted;
}
