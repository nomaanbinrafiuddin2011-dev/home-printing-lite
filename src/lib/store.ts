export interface UploadRow { id: string; storagePath: string; originalName: string; mimeType: string; sizeBytes: number; pages: number | null; tokenHash: string; status: 'pending' | 'ready'; expiresAt: string; claimedOrderId: string | null }
export interface OrderRow { id: string; orderNumber: string; idempotencyKey: string; customerName: string; phone: string; email: string | null; fulfilment: 'pickup' | 'delivery'; deliveryAddress: string | null; deliveryFeePaise: number; instructions: string | null; paymentMethod: 'cash'; paymentStatus: 'cash_pending'; status: 'pending_confirmation'; subtotalPaise: number; totalPaise: number }
export interface ItemRow { orderId: string; storagePath: string; originalName: string; mimeType: string; sizeBytes: number; totalPages: number; pageRange: string | null; copies: number; colorMode: 'bw' | 'c'; sides: 1 | 2; lineTotalPaise: number; paperSize: string; paperSizeId: string; paperWidthMm: number; paperHeightMm: number }
export type InsertOrderResult = 'ok' | 'order_number_conflict' | 'idempotency_conflict' | 'error';
export interface Store {
  getUpload(id: string): Promise<UploadRow | null>;
  getOrderByKey(key: string): Promise<OrderRow | null>;
  /** Atomic: succeeds only if the upload is currently unclaimed. */
  claimUpload(uploadId: string, orderId: string): Promise<boolean>;
  releaseUpload(uploadId: string, orderId: string): Promise<void>;
  insertOrder(o: OrderRow): Promise<InsertOrderResult>;
  insertItem(i: ItemRow): Promise<boolean>;
  deleteOrder(id: string): Promise<void>;
}
