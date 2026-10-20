import { DEFAULT_RATES } from './pricing.ts';
import type { Rates } from './pricing.ts';
import { defaultCatalogue } from './catalogue.ts';
import type { Catalogue } from './catalogue.ts';
export interface Settings {
  rates: Rates;
  delivery: { enabled: boolean; feePaise: number; minOrderPaise: number; radiusKm: number | null };
  pickupEnabled: boolean; cashEnabled: boolean; maxMb: number;
  /** Paper sizes, printers and per-size prices. `rates` above is the A4 pair kept for backward compatibility. */
  catalogue: Catalogue;
}
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
/** Safe defaults: anything missing or malformed disables the feature instead of inventing values. */
export function parseSettings(rows: Record<string, any>, catalogue?: Catalogue): Settings {
  const p = rows.pricing ?? {}, d = rows.delivery ?? {}, f = rows.fulfilment ?? {}, pay = rows.payments ?? {}, files = rows.files ?? {};
  const rates: Rates = int(p.bw_paise) && int(p.colour_paise) ? { bw_paise: p.bw_paise, colour_paise: p.colour_paise } : DEFAULT_RATES;
  return {
    rates, catalogue: catalogue ?? defaultCatalogue(rates),
    delivery: {
      enabled: d.enabled === true && int(d.fee_paise),
      feePaise: int(d.fee_paise) ? d.fee_paise : 0,
      minOrderPaise: int(d.min_order_paise) ? d.min_order_paise : 0,
      radiusKm: typeof d.radius_km === 'number' && d.radius_km > 0 ? d.radius_km : null,
    },
    pickupEnabled: f.pickup_enabled !== false,
    cashEnabled: pay.cash_enabled === true,
    maxMb: typeof files.max_mb === 'number' && files.max_mb >= 1 ? Math.min(files.max_mb, 25) : 25, // bucket hard limit is 25 MB
  };
}
