import { withAdmin } from '@/lib/admin-server';
import { printersForItems } from '@/lib/catalogue';
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GET = (req: Request, { params }: { params: { id: string } }) => withAdmin(req, false, async ({ store }) => {
  if (!UUID.test(params.id)) return { data: { ok: false, error: 'Invalid order.' }, status: 400 };
  const order = await store.getOrder(params.id);
  if (!order) return { data: { ok: false, error: 'Order not found.' }, status: 404 };
  const cat = await store.getCatalogue();   // printers that can do every file of this order (operator aid; not used for pricing)
  const suitablePrinters = printersForItems(cat, order.items.map(i => ({ paperSizeId: i.paperSizeId, paperSize: i.paperSize, colorMode: i.colorMode, sides: i.sides }))).map(p => p.name);
  return { data: { ok: true, order, suitablePrinters } };
});
