import type { SupabaseClient } from '@supabase/supabase-js';
import type { Admin, AuthBackend } from './admin-auth.ts';
import type { AdminItem, AdminOrder, AdminStore } from './admin-store.ts';
import { PROCESSING, QUEUE_STATUSES } from './order-status.ts';
import { loadSettings } from './store-supabase.ts';

export function supabaseAuthBackend(db: SupabaseClient, anon: SupabaseClient): AuthBackend {
  return {
    async getUser(at) { const { data, error } = await db.auth.getUser(at); return error || !data.user ? null : { id: data.user.id, email: data.user.email ?? '' }; },
    async isAdmin(id) { const { data, error } = await db.from('admin_users').select('user_id').eq('user_id', id).maybeSingle(); if (error) throw error; return !!data; },
    async refresh(rt) { const { data, error } = await anon.auth.refreshSession({ refresh_token: rt }); const s = data.session; return error || !s ? null : { accessToken: s.access_token, refreshToken: s.refresh_token, expiresIn: s.expires_in }; },
  };
}
const SEL = '*, order_items(*), cash_collections(*)';
const mapItem = (i: any): AdminItem => ({ id: i.id, originalName: i.original_name, totalPages: i.total_pages, pageRange: i.page_range, copies: i.copies, colorMode: i.color_mode, sides: i.sides, paperSize: i.paper_size ?? 'A4', paperSizeId: i.paper_size_id ?? null, paperWidthMm: i.paper_width_mm ?? null, paperHeightMm: i.paper_height_mm ?? null, orientation: i.orientation ?? 'portrait', lineTotalPaise: i.line_total_paise, hasFile: !!i.storage_path });
const mapOrder = (o: any): AdminOrder => {
  const c = Array.isArray(o.cash_collections) ? o.cash_collections[0] : o.cash_collections;
  return { id: o.id, orderNumber: o.order_number, customerName: o.customer_name, phone: o.phone, email: o.email, fulfilment: o.fulfilment, deliveryAddress: o.delivery_address, deliveryFeePaise: o.delivery_fee_paise, instructions: o.instructions, paymentMethod: o.payment_method, paymentStatus: o.payment_status, status: o.status, subtotalPaise: o.subtotal_paise, totalPaise: o.total_paise, cancelReason: o.cancel_reason, createdAt: o.created_at, items: (o.order_items ?? []).map(mapItem), collection: c ? { amountPaise: c.amount_paise, collectedAt: c.collected_at, collectedByEmail: c.collected_by_email } : null };
};

export function supabaseAdminStore(db: SupabaseClient): AdminStore {
  const count = async (f: (q: any) => any) => { const { count: n, error } = await f(db.from('orders').select('id', { count: 'exact', head: true })); if (error) throw error; return n ?? 0; };
  return {
    async listOrders(q) {
      let b = db.from('orders').select(SEL, { count: 'exact' }).order('created_at', { ascending: false });
      if (q.status !== 'all') b = b.eq('status', q.status);
      if (q.payment !== 'all') b = b.eq('payment_status', q.payment);
      if (q.fulfilment !== 'all') b = b.eq('fulfilment', q.fulfilment);
      if (q.from) b = b.gte('created_at', q.from + 'T00:00:00+05:30');
      if (q.to) b = b.lt('created_at', new Date(new Date(q.to + 'T00:00:00+05:30').getTime() + 86400_000).toISOString());
      if (q.q) b = b.or(`order_number.ilike.%${q.q}%,phone.ilike.%${q.q}%,customer_name.ilike.%${q.q}%`); // q is pre-sanitised to [A-Za-z0-9 +-]
      const from = (q.page - 1) * q.pageSize;
      const { data, count: total, error } = await b.range(from, from + q.pageSize - 1);
      if (error) throw error;
      return { orders: (data ?? []).map(mapOrder), total: total ?? 0 };
    },
    async listQueueCandidates() {
      const { data, error } = await db.from('orders').select(SEL).in('status', QUEUE_STATUSES).in('payment_status', ['cash_pending', 'paid']).order('created_at', { ascending: true }).limit(300);
      if (error) throw error;
      return { orders: (data ?? []).map(mapOrder), awaitingConfirmation: await count(q => q.eq('status', 'pending_confirmation')) };
    },
    async getOrder(id) { const { data, error } = await db.from('orders').select(SEL).eq('id', id).maybeSingle(); if (error) throw error; return data ? mapOrder(data) : null; },
    async stats() {
      const [total, pending, completed, cancelled, processing] = await Promise.all([count(q => q), count(q => q.eq('status', 'pending_confirmation')), count(q => q.eq('status', 'completed')), count(q => q.eq('status', 'cancelled')), count(q => q.in('status', PROCESSING))]);
      const { data, error } = await db.from('orders').select('total_paise').eq('payment_status', 'cash_pending').neq('status', 'cancelled').limit(5000);
      if (error) throw error;
      return { total, pending, processing, completed, cancelled, cashAwaiting: { count: data?.length ?? 0, totalPaise: (data ?? []).reduce((s, r) => s + r.total_paise, 0) } };
    },
    async setStatus(id, expected, next, a, reason) { const { data, error } = await db.rpc('admin_set_order_status', { p_order: id, p_expected: expected, p_next: next, p_admin: a.id, p_email: a.email, p_reason: reason }); if (error) throw error; return data; },
    async collectCash(id, a, amount, note) { const { data, error } = await db.rpc('admin_record_cash', { p_order: id, p_admin: a.id, p_email: a.email, p_amount: amount, p_note: note }); if (error) throw error; return data; },
    async getItemFile(itemId) { const { data, error } = await db.from('order_items').select('order_id,storage_path,original_name').eq('id', itemId).maybeSingle(); if (error) throw error; return data ? { orderId: data.order_id, storagePath: data.storage_path, name: data.original_name } : null; },
    async signedUrl(path, s, name) { const { data, error } = await db.storage.from('documents').createSignedUrl(path, s, name ? { download: name } : undefined); return error ? null : data.signedUrl; },
    async getCatalogue() { return (await loadSettings(db)).catalogue; },
    async addPaperSize(a, v) { const { data, error } = await db.rpc('admin_add_paper_size', { p_id: v.id, p_name: v.name, p_w: v.widthMm, p_h: v.heightMm, p_admin: a.id, p_email: a.email }); if (error) throw error; return data; },
    async setPaperSize(a, v) { const { data, error } = await db.rpc('admin_set_paper_size', { p_id: v.id, p_enabled: v.enabled ?? null, p_bw: v.bwPaise ?? null, p_c: v.cPaise ?? null, p_admin: a.id, p_email: a.email }); if (error) throw error; return data; },
    async savePrinter(a, v) { const { data, error } = await db.rpc('admin_save_printer', { p_id: v.id, p_name: v.name, p_active: v.active, p_colour: v.supportsColour, p_duplex: v.supportsDuplex, p_sizes: v.paperSizeIds, p_admin: a.id, p_email: a.email }); if (error) throw error; return data; },
    async getSettings() { const { data, error } = await db.from('settings').select('key,value'); if (error) throw error; return Object.fromEntries((data ?? []).map(r => [r.key, r.value])); },
    async setSetting(key, value, a) { const { error } = await db.rpc('admin_set_setting', { p_key: key, p_value: value, p_admin: a.id, p_email: a.email }); return !error; },
    async logEvent(a, action, entity, entityId, detail) { await db.rpc('admin_log_event', { p_admin: a.id, p_email: a.email, p_action: action, p_entity: entity, p_entity_id: entityId, p_detail: detail }); },
  };
}
