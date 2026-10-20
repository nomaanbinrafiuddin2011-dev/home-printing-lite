// Pure pricing logic. Used by the browser for instant preview AND by /api/price as the authority.
// All money is in paise (integer) to avoid floating-point errors.
export type Mode = 'bw' | 'c';
export type Sides = 1 | 2;
export interface Rates { bw_paise: number; colour_paise: number }
export const DEFAULT_RATES: Rates = { bw_paise: 200, colour_paise: 900 };
export const LIMITS = { maxPages: 2000, maxCopies: 500 };

export interface PriceInput { totalPages: number; range: string; copies: number; mode: Mode; sides: Sides }
export type PriceResult =
  | { ok: true; sidesPerCopy: number; copies: number; totalSides: number; sheets: number; ratePaise: number; totalPaise: number }
  | { ok: false; error: string };

export function expandRange(txt: string, max: number): { pages: number[] } | { error: string } {
  const set = new Set<number>();
  for (const raw of txt.split(',')) {
    const p = raw.trim(); if (!p) continue;
    const m = /^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.exec(p);
    if (!m) return { error: 'Use numbers and ranges like 1-3, 5, 8-10.' };
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b < a) return { error: `Check the range "${p}".` };
    if (b > max) return { error: `Page ${b} is beyond the ${max} pages in your document.` };
    for (let n = a; n <= b; n++) set.add(n);
  }
  return { pages: [...set].sort((x, y) => x - y) };
}
export function parseRange(txt: string, max: number): { count: number } | { error: string } {
  const r = expandRange(txt, max);
  return 'error' in r ? r : { count: r.pages.length };
}

export function calculatePrice(i: PriceInput, rates: Rates = DEFAULT_RATES): PriceResult {
  if (!Number.isInteger(i.totalPages) || i.totalPages < 1 || i.totalPages > LIMITS.maxPages) return { ok: false, error: `Pages must be between 1 and ${LIMITS.maxPages}.` };
  if (!Number.isInteger(i.copies) || i.copies < 1 || i.copies > LIMITS.maxCopies) return { ok: false, error: `Copies must be between 1 and ${LIMITS.maxCopies}.` };
  if (i.mode !== 'bw' && i.mode !== 'c') return { ok: false, error: 'Choose colour or black & white.' };
  if (i.sides !== 1 && i.sides !== 2) return { ok: false, error: 'Choose single or double sided.' };
  let sidesPerCopy = i.totalPages;
  if (i.range.trim()) {
    const r = parseRange(i.range, i.totalPages);
    if ('error' in r) return { ok: false, error: r.error };
    if (r.count < 1) return { ok: false, error: 'Select at least one page.' };
    sidesPerCopy = r.count;
  }
  const totalSides = sidesPerCopy * i.copies;
  const sheets = i.sides === 2 ? Math.ceil(sidesPerCopy / 2) * i.copies : totalSides;
  const ratePaise = i.mode === 'c' ? rates.colour_paise : rates.bw_paise;
  return { ok: true, sidesPerCopy, copies: i.copies, totalSides, sheets, ratePaise, totalPaise: totalSides * ratePaise };
}
export const rupees = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
