// Small helpers for checking user-supplied config: reporter options and themes.

/**
 * Edits needed to turn one string into the other, where swapping two
 * neighbouring letters counts as one (`titel` is one edit from `title`).
 */
function distance(a: string, b: string): number {
  let previous: number[] = [];
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        row[j]! + 1,
        next[j - 1]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        next[j] = Math.min(next[j]!, previous[j - 2]! + 1);
      }
    }
    previous = row;
    row = next;
  }
  return row[b.length]!;
}

/** ` Did you mean "x"?` for a near miss, case-insensitively, or ''. */
export function didYouMean(key: string, known: readonly string[]): string {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of known) {
    const d = distance(key.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best && bestDistance <= Math.max(1, Math.floor(key.length / 3))
    ? ` Did you mean "${best}"?`
    : '';
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
