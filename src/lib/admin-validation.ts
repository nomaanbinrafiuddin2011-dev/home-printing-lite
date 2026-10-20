import { DEFAULT_RATES } from './pricing.ts';
import { STATUSES } from './order-status.ts';

export interface SettingsForm { bwRupees: number; colourRupees: number; deliveryEnabled: boolean; deliveryFeeRupees: number; minOrderRupees: number; radiusKm: number | null; pickupEnabled: boolean; cashEnabled: boolean; maxMb: number; retentionDays: number }
export type V<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };
const bad = (error: string, field?: string): V<never> => ({ ok: false, error, field });
const toPaise = (r: number) => Math.round(r * 100);
const money = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && Math.abs(v * 100 - toPaise(v)) < 1e-6;

export function validateSettings(b: any): V<SettingsForm> {
  if (!b || typeof b !== 'object') return bad('Invalid request.');
  if (!money(b.bwRupees, 0.01, 1000)) return bad('Black & white rate must be between ₹0.01 and ₹1000 (at most 2 decimals).', 'bwRupees');
  if (!money(b.colourRupees, 0.01, 1000)) return bad('Colour rate must be between ₹0.01 and ₹1000 (at most 2 decimals).', 'colourRupees');
  if (typeof b.deliveryEnabled !== 'boolean' || typeof b.pickupEnabled !== 'boolean' || typeof b.cashEnabled !== 'boolean') return bad('Invalid on/off setting.');
  if (!money(b.deliveryFeeRupees, 0, 5000)) return bad('Delivery fee must be between ₹0 and ₹5000.', 'deliveryFeeRupees');
  if (!money(b.minOrderRupees, 0, 100000)) return bad('Minimum order must be between ₹0 and ₹100000.', 'minOrderRupees');
  if (b.radiusKm !== null && !(typeof b.radiusKm === 'number' && b.radiusKm >= 0.1 && b.radiusKm <= 100)) return bad('Delivery radius must be empty or between 0.1 and 100 km.', 'radiusKm');
  if (!Number.isInteger(b.maxMb) || b.maxMb < 1 || b.maxMb > 25) return bad('Maximum file size must be a whole number from 1 to 25 MB (25 MB is the storage limit).', 'maxMb');
  if (!Number.isInteger(b.retentionDays) || b.retentionDays < 1 || b.retentionDays > 365) return bad('File retention must be a whole number of days from 1 to 365.', 'retentionDays');
  if (!b.pickupEnabled && !b.deliveryEnabled) return bad('Enable pickup or delivery, otherwise customers cannot order.', 'pickupEnabled');
  if (!b.cashEnabled) return bad('Cash is the only payment method available right now. Turning it off would stop all orders.', 'cashEnabled');
  return { ok: true, value: { bwRupees: b.bwRupees, colourRupees: b.colourRupees, deliveryEnabled: b.deliveryEnabled, deliveryFeeRupees: b.deliveryFeeRupees, minOrderRupees: b.minOrderRupees, radiusKm: b.radiusKm, pickupEnabled: b.pickupEnabled, cashEnabled: b.cashEnabled, maxMb: b.maxMb, retentionDays: b.retentionDays } };
}
/** Merge the form into existing rows (keeps unknown keys such as notes). Online payment stays off. */
export function buildSettingRows(cur: Record<string, any>, f: SettingsForm): Record<string, any> {
  return {
    pricing: { ...cur.pricing, bw_paise: toPaise(f.bwRupees), colour_paise: toPaise(f.colourRupees) },
    delivery: { ...cur.delivery, enabled: f.deliveryEnabled, fee_paise: toPaise(f.deliveryFeeRupees), min_order_paise: toPaise(f.minOrderRupees), radius_km: f.radiusKm },
    fulfilment: { ...cur.fulfilment, pickup_enabled: f.pickupEnabled },
    payments: { ...cur.payments, cash_enabled: f.cashEnabled, online_enabled: false },
    files: { allowed: ['application/pdf'], ...cur.files, max_mb: f.maxMb },
    retention: { ...cur.retention, delete_files_after_days: f.retentionDays },
  };
}
export function rowsToForm(r: Record<string, any>): SettingsForm {
  const p = r.pricing ?? {}, d = r.delivery ?? {};
  return { bwRupees: (p.bw_paise ?? DEFAULT_RATES.bw_paise) / 100, colourRupees: (p.colour_paise ?? DEFAULT_RATES.colour_paise) / 100, deliveryEnabled: d.enabled === true, deliveryFeeRupees: (d.fee_paise ?? 0) / 100, minOrderRupees: (d.min_order_paise ?? 0) / 100, radiusKm: typeof d.radius_km === 'number' ? d.radius_km : null, pickupEnabled: r.fulfilment?.pickup_enabled !== false, cashEnabled: r.payments?.cash_enabled === true, maxMb: r.files?.max_mb ?? 25, retentionDays: r.retention?.delete_files_after_days ?? 7 };
}

export interface OrderQuery { q: string; status: string; payment: string; fulfilment: string; from: string; to: string; page: number; pageSize: number }
const PAY = ['pending', 'cash_pending', 'paid', 'failed', 'refund_pending', 'refunded'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Whitelist-parses list filters. The search text is reduced to a safe charset so it can never alter a query filter. */
export function parseOrderQuery(sp: URLSearchParams): V<OrderQuery> {
  const q = (sp.get('q') ?? '').replace(/[^A-Za-z0-9 +\-]/g, '').trim().slice(0, 60);
  const status = sp.get('status') ?? 'all', payment = sp.get('payment') ?? 'all', fulfilment = sp.get('fulfilment') ?? 'all';
  if (status !== 'all' && !(STATUSES as readonly string[]).includes(status)) return bad('Unknown status filter.');
  if (payment !== 'all' && !PAY.includes(payment)) return bad('Unknown payment filter.');
  if (fulfilment !== 'all' && fulfilment !== 'pickup' && fulfilment !== 'delivery') return bad('Unknown fulfilment filter.');
  const from = sp.get('from') ?? '', to = sp.get('to') ?? '';
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return bad('Dates must look like 2026-10-31.');
  const page = Math.max(1, Math.min(10000, parseInt(sp.get('page') ?? '1', 10) || 1));
  return { ok: true, value: { q, status, payment, fulfilment, from, to, page, pageSize: 20 } };
}
