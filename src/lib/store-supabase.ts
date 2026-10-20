import type { SupabaseClient } from '@supabase/supabase-js';
import type { Store, UploadRow } from './store.ts';
import { parseSettings } from './settings.ts';
import type { Settings } from './settings.ts';
import type { Catalogue } from './catalogue.ts';

/** null ONLY when the catalogue tables don't exist yet (migration 0005 not run). Any other failure throws, so a database hiccup
 *  can never silently fall back to the old A4-only setup (which could offer a size/printer you have switched off). */
export async function loadCatalogue(db: SupabaseClient): Promise<Catalogue | null> {
  const [sz, pr, ps, pp] = await Promise.all([db.from('paper_sizes').select('*'), db.from('printers').select('*'), db.from('printer_paper_sizes').select('*'), db.from('paper_prices').select('*')]);
  const errs = [sz, pr, ps, pp].map(r => r.error).filter(Boolean) as { code?: string; message?: string }[];
  if (errs.length) { if (errs.every(e => e.code === '42P01' || e.code === 'PGRST205')) return null; throw new Error('catalogue unavailable'); }
  if (!sz.data?.length) return null;
  const prices: Catalogue['prices'] = {};
  for (const r of pp.data ?? []) (prices[r.paper_size_id] ??= {})[r.color_mode as 'bw' | 'c'] = r.price_paise;
  return { fromDatabase: true, prices,
    sizes: sz.data.map((r: any) => ({ id: r.id, name: r.name, widthMm: r.width_mm, heightMm: r.height_mm, isCustom: r.is_custom, enabled: r.enabled, sortOrder: r.sort_order })),
    printers: (pr.data ?? []).map((r: any) => ({ id: r.id, name: r.name, active: r.active, supportsColour: r.supports_colour, supportsDuplex: r.supports_duplex, paperSizeIds: (ps.data ?? []).filter((x: any) => x.printer_id === r.id).map((x: any) => x.paper_size_id) })) };
}
export async function loadSettings(db: SupabaseClient): Promise<Settings> {
  const [{ data }, cat] = await Promise.all([db.from('settings').select('key,value').in('key', ['pricing', 'delivery', 'fulfilment', 'payments', 'files']), loadCatalogue(db)]);
  return parseSettings(Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value])), cat ?? undefined);
}
const toUpload = (r: any): UploadRow => ({ id: r.id, storagePath: r.storage_path, originalName: r.original_name, mimeType: r.mime_type, sizeBytes: Number(r.size_bytes), pages: r.pages, tokenHash: r.token_hash, status: r.status, expiresAt: r.expires_at, claimedOrderId: r.claimed_order_id });

export function supabaseStore(db: SupabaseClient): Store {
  return {
    async getUpload(id) { const { data } = await db.from('uploads').select('*').eq('id', id).maybeSingle(); return data ? toUpload(data) : null; },
    async getOrderByKey(key) {
      const { data } = await db.from('orders').select('*').eq('idempotency_key', key).maybeSingle();
      return data ? { id: data.id, orderNumber: data.order_number, idempotencyKey: key, customerName: data.customer_name, phone: data.phone, email: data.email, fulfilment: data.fulfilment, deliveryAddress: data.delivery_address, deliveryFeePaise: data.delivery_fee_paise, instructions: data.instructions, paymentMethod: 'cash', paymentStatus: 'cash_pending', status: 'pending_confirmation', subtotalPaise: data.subtotal_paise, totalPaise: data.total_paise } : null;
    },
    async claimUpload(uploadId, orderId) {
      const { data, error } = await db.from('uploads').update({ claimed_order_id: orderId }).eq('id', uploadId).is('claimed_order_id', null).select('id');
      return !error && (data?.length ?? 0) === 1;
    },
    async releaseUpload(uploadId, orderId) { await db.from('uploads').update({ claimed_order_id: null }).eq('id', uploadId).eq('claimed_order_id', orderId); },
    async insertOrder(o) {
      const { error } = await db.from('orders').insert({ id: o.id, order_number: o.orderNumber, idempotency_key: o.idempotencyKey, customer_name: o.customerName, phone: o.phone, email: o.email, fulfilment: o.fulfilment, delivery_address: o.deliveryAddress, delivery_fee_paise: o.deliveryFeePaise, instructions: o.instructions, payment_method: o.paymentMethod, payment_status: o.paymentStatus, status: o.status, subtotal_paise: o.subtotalPaise, total_paise: o.totalPaise });
      if (!error) return 'ok';
      if (error.code === '23505') return /idempotency/.test(error.message) ? 'idempotency_conflict' : 'order_number_conflict';
      return 'error';
    },
    async insertItem(i) {
      const base = { order_id: i.orderId, storage_path: i.storagePath, original_name: i.originalName, mime_type: i.mimeType, size_bytes: i.sizeBytes, total_pages: i.totalPages, page_range: i.pageRange, copies: i.copies, color_mode: i.colorMode, sides: i.sides, line_total_paise: i.lineTotalPaise };
      const { error } = await db.from('order_items').insert({ ...base, paper_size: i.paperSize, paper_size_id: i.paperSizeId, paper_width_mm: i.paperWidthMm, paper_height_mm: i.paperHeightMm });
      if (error?.code === '42703' && i.paperSizeId === 'a4') return !(await db.from('order_items').insert(base)).error;   // migration 0005 not applied yet: A4 only
      return !error;
    },
    async deleteOrder(id) { await db.from('orders').delete().eq('id', id); },
  };
}
