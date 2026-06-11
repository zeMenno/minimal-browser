/**
 * Tiny subsequence fuzzy matcher. Returns a score > 0 on match (higher is
 * better) or 0 when the query is not a subsequence of the target.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 1;
  if (t.includes(q)) {
    // Exact substring: strongly preferred, earlier and tighter is better
    return 1000 - t.indexOf(q) - (t.length - q.length) * 0.01;
  }
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return 0;
    streak = found === ti ? streak + 1 : 1;
    score += 1 + streak * 2;
    // Bonus for matching at a word boundary
    if (found === 0 || " /.-_:".includes(t[found - 1])) score += 4;
    ti = found + 1;
  }
  return score - t.length * 0.01;
}
