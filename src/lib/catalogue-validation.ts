import { sizeIdFromName } from './catalogue.ts';
import type { Catalogue } from './catalogue.ts';
import type { V } from './admin-validation.ts';

const bad = (error: string, field?: string): V<never> => ({ ok: false, error, field });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toPaise = (r: number) => Math.round(r * 100);
const money = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0.01 && v <= 10000 && Math.abs(v * 100 - toPaise(v)) < 1e-6;

export interface AddSize { id: string; name: string; widthMm: number; heightMm: number }
export function validateAddSize(b: any, cat: Catalogue): V<AddSize> {
  const name = typeof b?.name === 'string' ? b.name.trim() : '';
  if (name.length < 1 || name.length > 40 || !/^[A-Za-z0-9][A-Za-z0-9 .×x\-]*$/.test(name)) return bad('Name the size (1–40 letters, numbers, spaces, - . x).', 'name');
  for (const [k, l] of [['widthMm', 'Width'], ['heightMm', 'Height']] as const) if (!Number.isInteger(b?.[k]) || b[k] < 20 || b[k] > 1500) return bad(`${l} must be a whole number of millimetres from 20 to 1500.`, k);
  const id = ('custom-' + sizeIdFromName(name)).slice(0, 40).replace(/-+$/, '');
  if (cat.sizes.some(s => s.id === id || s.name.toLowerCase() === name.toLowerCase())) return bad('A paper size with this name already exists.', 'name');
  return { ok: true, value: { id, name, widthMm: b.widthMm, heightMm: b.heightMm } };
}
export interface SetSize { id: string; enabled?: boolean; bwPaise?: number; cPaise?: number }
export function validateSetSize(b: any, cat: Catalogue): V<SetSize> {
  const size = cat.sizes.find(s => s.id === b?.id); if (!size) return bad('Unknown paper size.');
  const v: SetSize = { id: size.id };
  if (b.enabled !== undefined) { if (typeof b.enabled !== 'boolean') return bad('Invalid on/off value.'); v.enabled = b.enabled; }
  if (b.bwRupees !== undefined) { if (!money(b.bwRupees)) return bad('B&W price must be between ₹0.01 and ₹10000 (max 2 decimals).', 'bwRupees'); v.bwPaise = toPaise(b.bwRupees); }
  if (b.colourRupees !== undefined) { if (!money(b.colourRupees)) return bad('Colour price must be between ₹0.01 and ₹10000 (max 2 decimals).', 'colourRupees'); v.cPaise = toPaise(b.colourRupees); }
  if (v.enabled === undefined && v.bwPaise === undefined && v.cPaise === undefined) return bad('Nothing to change.');
  const prices = cat.prices[size.id] ?? {};
  if (v.enabled === true && !size.enabled) {
    if (!(v.bwPaise ?? prices.bw) && !(v.cPaise ?? prices.c)) return bad(`Set a price for ${size.name} before enabling it. Prices are never guessed.`, 'bwRupees');
    if (!cat.printers.some(p => p.active && p.paperSizeIds.includes(size.id))) return bad(`Add or activate a printer that supports ${size.name} before enabling it.`);
  }
  if (v.enabled === false && size.enabled && cat.sizes.filter(s => s.enabled).length <= 1) return bad('At least one paper size must stay enabled.');
  return { ok: true, value: v };
}
export interface SavePrinter { id: string | null; name: string; active: boolean; supportsColour: boolean; supportsDuplex: boolean; paperSizeIds: string[] }
export function validateSavePrinter(b: any, cat: Catalogue): V<SavePrinter> {
  const id = b?.id === undefined || b?.id === null ? null : typeof b.id === 'string' && UUID.test(b.id) ? b.id : 'bad';
  if (id === 'bad') return bad('Invalid printer.');
  if (id && !cat.printers.some(p => p.id === id)) return bad('Printer not found.');
  const name = typeof b?.name === 'string' ? b.name.trim() : '';
  if (name.length < 1 || name.length > 60) return bad('Give the printer a name (1–60 characters).', 'name');
  if (cat.printers.some(p => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) return bad('A printer with this name already exists.', 'name');
  if (typeof b.active !== 'boolean' || typeof b.supportsColour !== 'boolean' || typeof b.supportsDuplex !== 'boolean') return bad('Invalid on/off value.');
  if (!Array.isArray(b.paperSizeIds) || b.paperSizeIds.some((x: unknown) => typeof x !== 'string')) return bad('Choose the paper sizes this printer supports.', 'paperSizeIds');
  const ids = [...new Set<string>(b.paperSizeIds)];
  if (ids.some(x => !cat.sizes.some(s => s.id === x))) return bad('Unknown paper size selected.', 'paperSizeIds');
  if (b.active && ids.length === 0) return bad('An active printer needs at least one supported paper size.', 'paperSizeIds');
  return { ok: true, value: { id, name, active: b.active, supportsColour: b.supportsColour, supportsDuplex: b.supportsDuplex, paperSizeIds: ids } };
}
