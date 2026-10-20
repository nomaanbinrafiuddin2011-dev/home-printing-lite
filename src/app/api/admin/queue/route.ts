import { withAdmin, fromAct } from '@/lib/admin-server';
import { getQueue } from '@/lib/admin-actions';
import { parseQueueQuery } from '@/lib/queue';
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => withAdmin(req, false, async ({ store }) => {
  const q = parseQueueQuery(new URL(req.url).searchParams);
  if (!q.ok) return { data: { ok: false, error: q.error }, status: 400 };
  return fromAct(await getQueue(store, q.value));
});
