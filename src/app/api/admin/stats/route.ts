import { withAdmin } from '@/lib/admin-server';
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => withAdmin(req, false, async ({ store }) => ({ data: { ok: true, stats: await store.stats() } }));
