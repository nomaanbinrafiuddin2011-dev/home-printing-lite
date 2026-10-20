import { expandRange } from './pricing.ts';
import type { AdminItem, AdminOrder } from './admin-store.ts';

/** [3,1,2,5,6,9] -> "1-3, 5-6, 9" */
export function formatRanges(pages: number[]): string {
  const p = [...new Set(pages)].sort((a, b) => a - b), out: string[] = [];
  for (let i = 0; i < p.length;) { let j = i; while (j + 1 < p.length && p[j + 1] === p[j] + 1) j++; out.push(j > i ? `${p[i]}-${p[j]}` : String(p[i])); i = j + 1; }
  return out.join(', ');
}
export type PrintType = 'bw' | 'colour' | 'mixed';
export const printTypeOf = (items: Pick<AdminItem, 'colorMode'>[]): PrintType => items.length && items.every(i => i.colorMode === 'c') ? 'colour' : items.every(i => i.colorMode === 'bw') ? 'bw' : 'mixed';
export const PRINT_TYPE_LABEL: Record<PrintType, string> = { bw: 'Black & white', colour: 'Colour', mixed: 'Mixed' };

export interface JobItem { fileName: string; totalPages: number; selection: string; selectedCount: number; copies: number; colour: 'Colour' | 'Black & white'; duplex: 'Single-sided' | 'Double-sided'; paper: string; paperDims: string | null; nonA4: boolean; orientation: string; sidesPerCopy: number; totalSides: number; sheets: number; warning?: string }
export interface JobSheet {
  orderNumber: string; createdAt: string; status: string; cancelled: boolean; customerName: string; phone: string; email: string | null;
  fulfilment: 'pickup' | 'delivery'; address: string | null; instructions: string | null;
  items: JobItem[]; printType: PrintType; totalSides: number; totalSheets: number;
  payment: { label: string; amountDuePaise: number };
}

export function buildJobItem(i: AdminItem): JobItem {
  let pages: number[] | null = null, warning: string | undefined;
  if (i.pageRange) { const e = expandRange(i.pageRange, i.totalPages); if ('pages' in e && e.pages.length) pages = e.pages; else warning = 'The saved page selection could not be read. Open the order and check it before printing.'; }
  const sidesPerCopy = pages ? pages.length : i.totalPages;
  const totalSides = sidesPerCopy * i.copies;
  const sheets = i.sides === 2 ? Math.ceil(sidesPerCopy / 2) * i.copies : totalSides;   // same rule as the price calculator
  return { fileName: i.originalName, totalPages: i.totalPages, selection: pages ? formatRanges(pages) : warning ? `${i.pageRange} (unreadable)` : `All ${i.totalPages} pages`, selectedCount: sidesPerCopy, copies: i.copies,
    colour: i.colorMode === 'c' ? 'Colour' : 'Black & white', duplex: i.sides === 2 ? 'Double-sided' : 'Single-sided', paper: i.paperSize, paperDims: i.paperWidthMm && i.paperHeightMm ? `${i.paperWidthMm} × ${i.paperHeightMm} mm` : null, nonA4: (i.paperSizeId ?? i.paperSize).toLowerCase() !== 'a4', orientation: i.orientation, sidesPerCopy, totalSides, sheets, ...(warning ? { warning } : {}) };
}
export function buildJobSheet(o: AdminOrder): JobSheet {
  const items = o.items.map(buildJobItem);
  const paid = o.paymentStatus === 'paid', cashDue = o.paymentStatus === 'cash_pending';
  return { orderNumber: o.orderNumber, createdAt: o.createdAt, status: o.status, cancelled: o.status === 'cancelled', customerName: o.customerName, phone: o.phone, email: o.email,
    fulfilment: o.fulfilment, address: o.fulfilment === 'delivery' ? o.deliveryAddress : null, instructions: o.instructions,
    items, printType: printTypeOf(o.items), totalSides: items.reduce((s, i) => s + i.totalSides, 0), totalSheets: items.reduce((s, i) => s + i.sheets, 0),
    payment: paid ? { label: o.collection ? 'PAID - cash received' : 'PAID', amountDuePaise: 0 } : cashDue ? { label: `COLLECT CASH ON ${o.fulfilment === 'delivery' ? 'DELIVERY' : 'PICKUP'}`, amountDuePaise: o.totalPaise } : { label: 'PAYMENT NOT CONFIRMED', amountDuePaise: o.totalPaise } };
}
