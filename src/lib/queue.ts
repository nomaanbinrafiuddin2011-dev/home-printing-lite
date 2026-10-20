import { QUEUE_STATUSES, STATUS_LABEL, nextStatuses } from './order-status.ts';
import type { Status } from './order-status.ts';
import { buildJobSheet, printTypeOf } from './jobsheet.ts';
import type { PrintType } from './jobsheet.ts';
import type { AdminOrder } from './admin-store.ts';
import { printersForItems, sizeIdFromName } from './catalogue.ts';
import type { Catalogue } from './catalogue.ts';

export const STAGES = { to_print: ['confirmed', 'preparing', 'printing'], handover: ['ready_for_pickup', 'out_for_delivery'], all: QUEUE_STATUSES } as Record<string, Status[]>;
/** Friendlier names for the queue; the underlying statuses and rules are unchanged. */
export const QUEUE_LABEL: Record<string, string> = { confirmed: 'Queued', preparing: 'Preparing', printing: 'Printing', ready_for_pickup: 'Ready for pickup', out_for_delivery: 'Out for delivery' };
const PAYABLE = ['cash_pending', 'paid'];

export function eligibility(o: AdminOrder): { eligible: true } | { eligible: false; reason: string } {
  if (!(QUEUE_STATUSES as string[]).includes(o.status)) return { eligible: false, reason: o.status === 'pending_confirmation' ? 'Not confirmed yet' : `Status is ${STATUS_LABEL[o.status as Status] ?? o.status}` };
  if (!PAYABLE.includes(o.paymentStatus)) return { eligible: false, reason: 'Payment is not valid for printing' };
  if (!o.items.length) return { eligible: false, reason: 'Order has no file' };
  if (o.items.some(i => !i.hasFile)) return { eligible: false, reason: 'The PDF is no longer available (deleted)' };
  return { eligible: true };
}

export interface NextAction { to: Status; label: string }
/** The single forward step for the primary button. null = nothing to do here (e.g. cash must be recorded first). */
export function nextAction(o: AdminOrder): NextAction | null {
  const to = nextStatuses(o.status as Status, o.fulfilment).find(s => s !== 'cancelled'); if (!to) return null;
  if (to === 'completed' && o.paymentStatus !== 'paid') return null;
  const label: Record<string, string> = { preparing: 'Start preparing', printing: 'Start printing', ready_for_pickup: 'Mark ready for pickup', out_for_delivery: 'Mark out for delivery', completed: 'Mark completed' };
  return { to, label: label[to] ?? 'Next' };
}

export interface QueueRow {
  id: string; orderNumber: string; customerName: string; createdAt: string; status: Status; statusLabel: string; printType: PrintType;
  selection: string; copies: number; sides: 'Single-sided' | 'Double-sided' | 'Mixed'; totalSides: number; sheets: number;
  fulfilment: 'pickup' | 'delivery'; instructions: string | null; paymentStatus: string; totalPaise: number;
  files: { id: string; name: string }[]; next: NextAction | null; canRecordCash: boolean; warning: boolean;
  paper: string; paperId: string; nonA4: boolean; noPrinter: boolean;
}
export function toRow(o: AdminOrder, cat?: Catalogue): QueueRow {
  const js = buildJobSheet(o), sides = new Set(o.items.map(i => i.sides));
  return { id: o.id, orderNumber: o.orderNumber, customerName: o.customerName, createdAt: o.createdAt, status: o.status as Status, statusLabel: QUEUE_LABEL[o.status] ?? o.status, printType: printTypeOf(o.items),
    selection: js.items.map(i => i.selection).join(' | '), copies: o.items.reduce((s, i) => s + i.copies, 0), sides: sides.size > 1 ? 'Mixed' : sides.has(2) ? 'Double-sided' : 'Single-sided',
    totalSides: js.totalSides, sheets: js.totalSheets, fulfilment: o.fulfilment, instructions: o.instructions, paymentStatus: o.paymentStatus, totalPaise: o.totalPaise,
    files: o.items.map(i => ({ id: i.id, name: i.originalName })), next: nextAction(o),
    canRecordCash: o.paymentMethod === 'cash' && o.paymentStatus === 'cash_pending' && (o.status === 'ready_for_pickup' || o.status === 'out_for_delivery'), warning: js.items.some(i => !!i.warning),
    paper: [...new Set(o.items.map(i => i.paperSize))].join(', '), paperId: o.items[0]?.paperSizeId ?? sizeIdFromName(o.items[0]?.paperSize ?? 'a4'), nonA4: js.items.some(i => i.nonA4),
    noPrinter: cat ? printersForItems(cat, o.items.map(i => ({ paperSizeId: i.paperSizeId, paperSize: i.paperSize, colorMode: i.colorMode, sides: i.sides }))).length === 0 : false };
}

export interface QueueQuery { stage: 'to_print' | 'handover' | 'all'; status: string; type: string; fulfilment: string; sort: 'next' | 'time' | 'status' | 'type' | 'fulfilment'; dir: 'asc' | 'desc'; paper?: string }
export function parseQueueQuery(sp: URLSearchParams): { ok: true; value: QueueQuery } | { ok: false; error: string } {
  const pick = <T extends string>(k: string, allowed: readonly T[], d: T): T | null => { const v = sp.get(k) ?? d; return (allowed as readonly string[]).includes(v) ? (v as T) : null; };
  const stage = pick('stage', ['to_print', 'handover', 'all'] as const, 'to_print'), type = pick('type', ['all', 'bw', 'colour', 'mixed'] as const, 'all'), fulfilment = pick('fulfilment', ['all', 'pickup', 'delivery'] as const, 'all');
  const sort = pick('sort', ['next', 'time', 'status', 'type', 'fulfilment'] as const, 'next'), dir = pick('dir', ['asc', 'desc'] as const, 'asc'), status = sp.get('status') ?? 'all';
  if (!stage || !type || !fulfilment || !sort || !dir) return { ok: false, error: 'Invalid filter.' };
  if (status !== 'all' && !(QUEUE_STATUSES as string[]).includes(status)) return { ok: false, error: 'Unknown status filter.' };
  const paper = sp.get('paper') ?? 'all';
  if (paper !== 'all' && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(paper)) return { ok: false, error: 'Unknown paper size filter.' };
  return { ok: true, value: { stage, status, type, fulfilment, sort, dir, paper } };
}

const RANK_NEXT: Record<string, number> = { printing: 0, preparing: 1, confirmed: 2, ready_for_pickup: 3, out_for_delivery: 4 };   // finish what is in progress first
const RANK_PIPE: Record<string, number> = { confirmed: 0, preparing: 1, printing: 2, ready_for_pickup: 3, out_for_delivery: 4 };      // pipeline order
const RANK_TYPE: Record<string, number> = { bw: 0, colour: 1, mixed: 2 };
const RANK_FUL: Record<string, number> = { pickup: 0, delivery: 1 };

export function filterAndSort(rows: QueueRow[], q: QueueQuery): QueueRow[] {
  const stage = STAGES[q.stage] as string[];
  const out = rows.filter(r => stage.includes(r.status) && (q.status === 'all' || r.status === q.status) && (q.type === 'all' || r.printType === q.type) && (q.fulfilment === 'all' || r.fulfilment === q.fulfilment) && (!q.paper || q.paper === 'all' || r.paperId === q.paper));
  const key = (r: QueueRow): number => q.sort === 'next' ? RANK_NEXT[r.status] : q.sort === 'status' ? RANK_PIPE[r.status] : q.sort === 'type' ? RANK_TYPE[r.printType] : q.sort === 'fulfilment' ? RANK_FUL[r.fulfilment] : new Date(r.createdAt).getTime();
  const sign = q.sort === 'next' ? 1 : q.dir === 'desc' ? -1 : 1;
  return out.sort((a, b) => (key(a) - key(b)) * sign || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.orderNumber.localeCompare(b.orderNumber));
}
export interface QueueData { rows: QueueRow[]; nextUp: QueueRow | null; counts: { toPrint: number; handover: number; byStatus: Record<string, number> }; batch: Record<PrintType, { orders: number; sides: number }>; awaitingConfirmation: number; papers: { id: string; name: string }[]; hidden: { orderNumber: string; reason: string }[] }
export function buildQueue(orders: AdminOrder[], awaitingConfirmation: number, q: QueueQuery, cat?: Catalogue): QueueData {
  const hidden: QueueData['hidden'] = [], all: QueueRow[] = [];
  for (const o of orders) { const e = eligibility(o); if (e.eligible) all.push(toRow(o, cat)); else if ((QUEUE_STATUSES as string[]).includes(o.status)) hidden.push({ orderNumber: o.orderNumber, reason: e.reason }); }
  const toPrint = all.filter(r => (STAGES.to_print as string[]).includes(r.status)), byStatus: Record<string, number> = {};
  for (const r of all) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const batch = { bw: { orders: 0, sides: 0 }, colour: { orders: 0, sides: 0 }, mixed: { orders: 0, sides: 0 } };
  for (const r of toPrint) { batch[r.printType].orders++; batch[r.printType].sides += r.totalSides; }
  return { rows: filterAndSort(all, q), nextUp: filterAndSort(toPrint, { ...q, stage: 'to_print', status: 'all', type: 'all', fulfilment: 'all', sort: 'next', dir: 'asc', paper: 'all' })[0] ?? null,
    counts: { toPrint: toPrint.length, handover: all.length - toPrint.length, byStatus }, batch, awaitingConfirmation, papers: [...new Map(all.map(r => [r.paperId, { id: r.paperId, name: r.paper }])).values()], hidden: hidden.slice(0, 10) };
}
