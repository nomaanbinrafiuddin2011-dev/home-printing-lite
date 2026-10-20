import type { Mode, Rates, Sides } from './pricing.ts';

export interface PaperSize { id: string; name: string; widthMm: number; heightMm: number; isCustom: boolean; enabled: boolean; sortOrder: number }
export interface Printer { id: string; name: string; active: boolean; supportsColour: boolean; supportsDuplex: boolean; paperSizeIds: string[] }
/** prices are in paise per printed side, per size and colour mode. A missing price means "not offered": nothing is ever guessed. */
export interface Catalogue { sizes: PaperSize[]; printers: Printer[]; prices: Record<string, { bw?: number; c?: number }>; fromDatabase?: boolean }

/** Used only when the catalogue tables don't exist yet (migration 0005 not run): the original A4-only service. */
export function defaultCatalogue(rates: Rates): Catalogue {
  return { fromDatabase: false, sizes: [{ id: 'a4', name: 'A4', widthMm: 210, heightMm: 297, isCustom: false, enabled: true, sortOrder: 40 }],
    printers: [{ id: 'default', name: 'Main printer', active: true, supportsColour: true, supportsDuplex: true, paperSizeIds: ['a4'] }], prices: { a4: { bw: rates.bw_paise, c: rates.colour_paise } } };
}
export const sizeIdFromName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** A printer qualifies only if ONE active printer has the size, colour (if needed) and duplex (if needed) together. */
export function suitablePrinters(cat: Catalogue, sizeId: string, mode: Mode, sides: Sides): Printer[] {
  return cat.printers.filter(p => p.active && p.paperSizeIds.includes(sizeId) && (mode !== 'c' || p.supportsColour) && (sides !== 2 || p.supportsDuplex));
}
export type Orderable =
  | { ok: true; size: PaperSize; ratePaise: number; printers: Printer[] }
  | { ok: false; error: string; code: 'bad_input' | 'unknown_size' | 'no_printer' | 'no_colour' | 'no_duplex' | 'no_price' };
const no = (code: Extract<Orderable, { ok: false }>['code'], error: string): Orderable => ({ ok: false, code, error });

export function checkOrderable(cat: Catalogue, sizeId: string, mode: unknown, sides: unknown): Orderable {
  if (mode !== 'bw' && mode !== 'c') return no('bad_input', 'Choose colour or black & white.');
  if (sides !== 1 && sides !== 2) return no('bad_input', 'Choose single or double sided.');
  const size = cat.sizes.find(s => s.id === sizeId);
  if (!size || !size.enabled) return no('unknown_size', 'That paper size is not available.');
  if (suitablePrinters(cat, size.id, 'bw', 1).length === 0) return no('no_printer', `${size.name} is not available right now.`);
  const printers = suitablePrinters(cat, size.id, mode, sides);
  if (printers.length === 0) {
    if (mode === 'c' && suitablePrinters(cat, size.id, 'c', 1).length === 0) return no('no_colour', `Colour printing is not available on ${size.name}.`);
    return no('no_duplex', `Double-sided printing is not available for ${size.name}${mode === 'c' ? ' in colour' : ''}.`);
  }
  const rate = cat.prices[size.id]?.[mode];
  if (!(typeof rate === 'number' && Number.isInteger(rate) && rate > 0)) return no('no_price', `${size.name} ${mode === 'c' ? 'colour' : 'black & white'} printing is not available.`);
  return { ok: true, size, ratePaise: rate, printers };
}

export interface PublicSize { id: string; name: string; widthMm: number; heightMm: number; available: boolean; prices: { bw: number | null; c: number | null }; options: { bw: { single: boolean; double: boolean }; c: { single: boolean; double: boolean } } }
/** What customers may see. Disabled sizes are hidden entirely; enabled-but-unservable sizes are shown as unavailable. */
export function publicCatalogue(cat: Catalogue): PublicSize[] {
  const ok = (id: string, m: Mode, s: Sides) => checkOrderable(cat, id, m, s).ok;
  return cat.sizes.filter(s => s.enabled).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map(s => {
    const options = { bw: { single: ok(s.id, 'bw', 1), double: ok(s.id, 'bw', 2) }, c: { single: ok(s.id, 'c', 1), double: ok(s.id, 'c', 2) } };
    return { id: s.id, name: s.name, widthMm: s.widthMm, heightMm: s.heightMm, available: Object.values(options).some(o => o.single || o.double), prices: { bw: cat.prices[s.id]?.bw ?? null, c: cat.prices[s.id]?.c ?? null }, options };
  });
}
/** Problems the admin should know about (shown on the Paper & printers page). */
export function catalogueWarnings(cat: Catalogue): string[] {
  const w: string[] = [];
  for (const s of cat.sizes.filter(x => x.enabled)) {
    const ps = cat.printers.filter(p => p.active && p.paperSizeIds.includes(s.id)), pr = cat.prices[s.id] ?? {};
    if (!ps.length) w.push(`${s.name} is enabled but no active printer supports it, so customers see it as unavailable.`);
    if (!pr.bw && !pr.c) w.push(`${s.name} is enabled but has no price.`);
    else { if (ps.some(p => p.supportsColour) && !pr.c) w.push(`${s.name}: colour has no price, so colour is not offered.`); if (!pr.bw) w.push(`${s.name}: black & white has no price, so it is not offered.`); }
  }
  for (const p of cat.printers.filter(x => x.active && x.paperSizeIds.length === 0)) w.push(`Printer "${p.name}" is active but supports no paper size.`);
  if (!cat.printers.some(p => p.active)) w.push('No printer is active, so customers cannot place orders.');
  return w;
}
/** Printers able to do EVERY file of an order, for the operator (job sheet / queue). */
export function printersForItems(cat: Catalogue, items: { paperSizeId?: string | null; paperSize: string; colorMode: Mode; sides: Sides }[]): Printer[] {
  if (!items.length) return [];
  return cat.printers.filter(p => items.every(i => suitablePrinters(cat, i.paperSizeId ?? sizeIdFromName(i.paperSize), i.colorMode, i.sides).some(x => x.id === p.id)));
}
