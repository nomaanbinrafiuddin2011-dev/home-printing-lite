import { withAdmin, fromAct } from '@/lib/admin-server';
import { collectCash } from '@/lib/admin-actions';
export const dynamic = 'force-dynamic';
export const POST = (req: Request, { params }: { params: { id: string } }) => withAdmin(req, true, async ({ admin, store }) => {
  let b: unknown; try { b = await req.json(); } catch { return { data: { ok: false, error: 'Invalid request.' }, status: 400 }; }
  return fromAct(await collectCash(store, admin, params.id, b));
});
