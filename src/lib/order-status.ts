export const STATUSES = ['pending_confirmation', 'confirmed', 'preparing', 'printing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { pending_confirmation: 'Pending confirmation', confirmed: 'Confirmed', preparing: 'Preparing', printing: 'Printing', ready_for_pickup: 'Ready for pickup', out_for_delivery: 'Out for delivery', completed: 'Completed', cancelled: 'Cancelled' };
export const HANDOVER: Status[] = ['ready_for_pickup', 'out_for_delivery'];
export const PROCESSING: Status[] = ['confirmed', 'preparing', 'printing', 'ready_for_pickup', 'out_for_delivery'];
export const isStatus = (v: unknown): v is Status => typeof v === 'string' && (STATUSES as readonly string[]).includes(v);

/** The only allowed moves. Terminal states (completed, cancelled) have none. */
export function nextStatuses(from: Status, fulfilment: 'pickup' | 'delivery'): Status[] {
  const handover: Status = fulfilment === 'delivery' ? 'out_for_delivery' : 'ready_for_pickup';
  const map: Record<Status, Status[]> = {
    pending_confirmation: ['confirmed', 'cancelled'], confirmed: ['preparing', 'cancelled'], preparing: ['printing', 'cancelled'],
    printing: [handover, 'cancelled'], ready_for_pickup: ['completed', 'cancelled'], out_for_delivery: ['completed', 'cancelled'], completed: [], cancelled: [],
  };
  return map[from];
}
export const canTransition = (from: Status, to: Status, f: 'pickup' | 'delivery') => nextStatuses(from, f).includes(to);

/** Statuses an order can be in while it appears in the print queue (pending_confirmation must be confirmed first). */
export const QUEUE_STATUSES: Status[] = ['confirmed', 'preparing', 'printing', 'ready_for_pickup', 'out_for_delivery'];
