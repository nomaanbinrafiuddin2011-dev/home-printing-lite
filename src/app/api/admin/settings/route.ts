import { withAdmin, fromAct } from '@/lib/admin-server';
import { saveSettings } from '@/lib/admin-actions';
import { rowsToForm } from '@/lib/admin-validation';
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => withAdmin(req, false, async ({ store }) => ({ data: { ok: true, settings: rowsToForm(await store.getSettings()) } }));
export const PUT = (req: Request) => withAdmin(req, true, async ({ admin, store }) => {
  let b: unknown; try { b = await req.json(); } catch { return { data: { ok: false, error: 'Invalid request.' }, status: 400 }; }
  return fromAct(await saveSettings(store, admin, b));
});
