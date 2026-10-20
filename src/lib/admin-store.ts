import type { Admin } from './admin-auth.ts';
import type { OrderQuery } from './admin-validation.ts';
import type { Catalogue } from './catalogue.ts';
import type { AddSize, SavePrinter, SetSize } from './catalogue-validation.ts';
export interface AdminItem { id: string; originalName: string; totalPages: number; pageRange: string | null; copies: number; colorMode: 'bw' | 'c'; sides: 1 | 2; paperSize: string; paperSizeId?: string | null; paperWidthMm?: number | null; paperHeightMm?: number | null; orientation: string; lineTotalPaise: number; hasFile: boolean }
export interface AdminOrder { id: string; orderNumber: string; customerName: string; phone: string; email: string | null; fulfilment: 'pickup' | 'delivery'; deliveryAddress: string | null; deliveryFeePaise: number; instructions: string | null; paymentMethod: string; paymentStatus: string; status: string; subtotalPaise: number; totalPaise: number; cancelReason: string | null; createdAt: string; items: AdminItem[]; collection: { amountPaise: number; collectedAt: string; collectedByEmail: string | null } | null }
export interface Stats { total: number; pending: number; processing: number; completed: number; cancelled: number; cashAwaiting: { count: number; totalPaise: number } }
export interface AdminStore {
  listOrders(q: OrderQuery): Promise<{ orders: AdminOrder[]; total: number }>;
  getOrder(id: string): Promise<AdminOrder | null>;
  stats(): Promise<Stats>;
  /** Active orders with a usable payment state, oldest first, plus how many still await confirmation. */
  listQueueCandidates(): Promise<{ orders: AdminOrder[]; awaitingConfirmation: number }>;
  setStatus(orderId: string, expected: string, next: string, admin: Admin, reason: string | null): Promise<'ok' | 'conflict' | 'not_found'>;
  collectCash(orderId: string, admin: Admin, amountPaise: number, note: string | null): Promise<'ok' | 'duplicate' | 'invalid' | 'not_found'>;
  getItemFile(itemId: string): Promise<{ orderId: string; storagePath: string | null; name: string } | null>;
  signedUrl(path: string, seconds: number, downloadName?: string): Promise<string | null>;
  getCatalogue(): Promise<Catalogue>;
  addPaperSize(admin: Admin, v: AddSize): Promise<'ok' | 'duplicate'>;
  setPaperSize(admin: Admin, v: SetSize): Promise<'ok' | 'not_found' | 'no_price' | 'no_printer' | 'last_size'>;
  savePrinter(admin: Admin, v: SavePrinter): Promise<{ result: 'ok' | 'not_found' | 'duplicate' | 'invalid'; id?: string }>;
  getSettings(): Promise<Record<string, any>>;
  setSetting(key: string, value: unknown, admin: Admin): Promise<boolean>;
  logEvent(admin: Admin, action: string, entity: string, entityId: string, detail: unknown): Promise<void>;
}
