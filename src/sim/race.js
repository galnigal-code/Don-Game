// Live ranking: finished cars first (by finish time), then the rest by distance.
export function computeRanks(cars) {
  const sorted = [...cars].sort((a, b) => {
    const fa = a.finishTime != null, fb = b.finishTime != null;
    if (fa && fb) return a.finishTime - b.finishTime;
    if (fa) return -1;
    if (fb) return 1;
    return b.s - a.s;
  });
  sorted.forEach((c, i) => { c.rank = i + 1; });
  return sorted;
}
