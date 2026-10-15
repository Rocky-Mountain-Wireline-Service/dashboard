/**
 * GA4 traffic sources in the words a business owner would use.
 *
 * Shared by the live analytics page and the monthly report, so the two never
 * name the same visit differently.
 */

const SEARCH_ENGINES = ['google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave'];
const ENGINE_NAMES: Record<string, string> = { duckduckgo: 'DuckDuckGo' };
/** Beyond this many rows the list is a tail of one-visit sources nobody acts on. */
const MAX_SOURCES = 6;
const AI_ASSISTANTS = ['chatgpt', 'openai', 'perplexity', 'claude', 'gemini', 'copilot'];
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function describeSources(
  rows: { source: string; medium: string; visits: number }[],
  max = MAX_SOURCES
): { name: string; desc: string; visits: number }[] {
  // Several GA4 rows can describe the same thing in plain terms (facebook.com,
  // m.facebook.com and l.facebook.com are all "Facebook"), so they are merged.
  const merged = new Map<string, { name: string; desc: string; visits: number }>();

  for (const row of rows) {
    const source = row.source.toLowerCase();
    const medium = row.medium.toLowerCase();
    let name: string;
    let desc = '';

    if (source === '(direct)' || !source || source === '(not set)') {
      name = 'Direct';
      desc = 'Typed the address, used a bookmark, or followed a link in an email';
    } else if (source.includes('google') && ['cpc', 'ppc', 'paid'].includes(medium)) {
      name = 'Google Ads';
      desc = 'Clicked a paid advert';
    } else if (medium === 'organic' && SEARCH_ENGINES.some((e) => source.includes(e))) {
      const engine = SEARCH_ENGINES.find((e) => source.includes(e))!;
      name = `${ENGINE_NAMES[engine] ?? titleCase(engine)} Search`;
      desc = 'Searched and found you';
    } else if (AI_ASSISTANTS.some((a) => source.includes(a))) {
      name = 'AI assistants';
      desc = 'Followed a link from ChatGPT or a similar tool';
    } else if (source.includes('facebook') || source.includes('fb.')) {
      name = 'Facebook';
      desc = 'A post or profile link';
    } else if (source.includes('linkedin') || source === 'lnkd.in') {
      name = 'LinkedIn';
      desc = 'A post or profile link';
    } else {
      name = row.source.replace(/^https?:\/\//, '').replace(/\/$/, '');
      desc = medium === 'referral' ? 'A link on another website' : '';
    }

    const existing = merged.get(name);
    if (existing) existing.visits += row.visits;
    else merged.set(name, { name, desc, visits: row.visits });
  }

  const sorted = [...merged.values()].sort((a, b) => b.visits - a.visits);
  if (sorted.length <= max) return sorted;

  const rest = sorted.slice(max - 1);
  return [
    ...sorted.slice(0, max - 1),
    {
      name: 'Everything else',
      desc: `${rest.length} smaller sources`,
      visits: rest.reduce((sum, r) => sum + r.visits, 0),
    },
  ];
}
