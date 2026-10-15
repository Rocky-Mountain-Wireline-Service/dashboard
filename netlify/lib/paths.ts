/**
 * Page addresses as GA4 reports them, made comparable.
 *
 * `/contact/` and `/contact` are one page (the old site wrote the first, the
 * rebuilt one the second), and tracking parameters arrive both plain
 * (?fbclid=…) and percent-encoded.
 */
export const cleanPath = (path: string) => path.split(/\?|%3F/i)[0].replace(/(.)\/+$/, '$1') || '/';

/** Adds up rows whose addresses differ only in the ways above. */
export function mergePaths(rows: { path: string; visits: number }[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const row of rows) {
    const path = cleanPath(row.path);
    merged.set(path, (merged.get(path) ?? 0) + row.visits);
  }
  return merged;
}

/** Service detail pages on their own, named as a person would say them. */
export function servicesFrom(pages: Map<string, number>, limit = 8) {
  return [...pages]
    .filter(([path, count]) => /^\/services\/[a-z0-9-]+$/.test(path) && count > 0)
    .map(([path, count]) => ({
      path,
      name: path
        .split('/')[2]
        .split('-')
        .map((w) => (w === 'and' ? w : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' '),
      visits: count,
    }))
    .sort((x, y) => y.visits - x.visits)
    .slice(0, limit);
}
