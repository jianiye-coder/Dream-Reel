/* Tidying model output (titles, tags, questions) before it reaches the page. */

/** Trimmed, and cut to maxLength characters. */
export function limitText(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

/** Up to `limit` non-empty items, each limited, without case-insensitive repeats. */
export function cleanList(values: string[], limit: number, maxLength: number): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const value of values) {
    const item = limitText(value, maxLength);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(item);
    if (cleaned.length >= limit) break;
  }

  return cleaned;
}
