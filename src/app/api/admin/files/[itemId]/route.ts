import { withAdmin, fromAct } from '@/lib/admin-server';
import { fileLink } from '@/lib/admin-actions';
export const dynamic = 'force-dynamic';
/** Returns a 60-second signed URL. Each request is recorded in the audit log. Files are never public. */
export const GET = (req: Request, { params }: { params: { itemId: string } }) => withAdmin(req, false, async ({ admin, store }) =>
  fromAct(await fileLink(store, admin, params.itemId, new URL(req.url).searchParams.get('mode'))));
