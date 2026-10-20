import { withAdmin, fromAct } from '@/lib/admin-server';
import { catalogueAction, catalogueView } from '@/lib/admin-actions';
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => withAdmin(req, false, async ({ store }) => fromAct(await catalogueView(store)));
export const PUT = (req: Request) => withAdmin(req, true, async ({ admin, store }) => {
  let b: unknown; try { b = await req.json(); } catch { return { data: { ok: false, error: 'Invalid request.' }, status: 400 }; }
  return fromAct(await catalogueAction(store, admin, b));
});
