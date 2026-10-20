import { withAdmin } from '@/lib/admin-server';
import { parseOrderQuery } from '@/lib/admin-validation';
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => withAdmin(req, false, async ({ store }) => {
  const q = parseOrderQuery(new URL(req.url).searchParams);
  if (!q.ok) return { data: { ok: false, error: q.error }, status: 400 };
  const r = await store.listOrders(q.value);
  return { data: { ok: true, ...r, page: q.value.page, pageSize: q.value.pageSize } };
});
