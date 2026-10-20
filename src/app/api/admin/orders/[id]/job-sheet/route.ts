import { withAdmin, fromAct } from '@/lib/admin-server';
import { logJobSheetPrint } from '@/lib/admin-actions';
export const dynamic = 'force-dynamic';
export const POST = (req: Request, { params }: { params: { id: string } }) => withAdmin(req, true, async ({ admin, store }) => fromAct(await logJobSheetPrint(store, admin, params.id)));
