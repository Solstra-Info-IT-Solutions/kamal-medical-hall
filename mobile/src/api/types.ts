export type Role = 'customer' | 'admin' | 'delivery_partner';
export type OrderStatus = 'requested' | 'quoted' | 'accepted' | 'awaiting_payment' | 'ready_to_dispatch' | 'out_for_delivery' | 'delivered' | 'rejected' | 'cancelled';
export type OrderKind = 'prescription' | 'medicines';
export type PaymentMethod = 'razorpay' | 'cod';

export interface User { id: string; phone: string; role: Role; name: string | null; email: string | null; language?: string }

export interface Address {
  id: string; label: 'home' | 'office' | 'other'; recipientName: string; phone: string;
  line1: string; line2?: string | null; landmark?: string | null; pincode: string; city: string;
  latitude?: number | null; longitude?: number | null;
}
export type AddressInput = Omit<Address, 'id' | 'city'>;

export interface DeliveryDay { date: string; slots: { id: string; label: string; available: boolean }[] }
export interface StoreConfig {
  store: { isOpen: boolean; openingTime: string; closingTime: string; address: string | null; phone: string | null; email: string | null };
  deliveryDays: DeliveryDay[];
  authMode: 'dev' | 'firebase';
}

export interface Order {
  id: string; orderNumber: string; kind: OrderKind; status: OrderStatus; note: string | null;
  address: { recipientName: string; phone: string; line1: string; line2?: string; landmark?: string; pincode: string; city: string; latitude?: number; longitude?: number };
  deliveryDate: string; deliverySlot: string; quotedAmount: number | null; quoteExpiresAt: string | null;
  paymentMethod: PaymentMethod | null; paymentStatus: string | null; rejectionReason: string | null; cancelReason: string | null;
  createdAt: string;
  items: { id: string; name: string; quantity: number }[];
  prescriptions: { id: string; mimeType: string; sizeBytes: number | null; url: string | null }[];
  history: { status: OrderStatus; reason: string | null; created_at: string }[];
  customer?: { id: string; name: string | null; phone: string };
  partner: { id: string; name: string | null; phone?: string } | null;
}
export interface OrderSummary {
  id: string; orderNumber: string; kind: OrderKind; status: OrderStatus; createdAt: string; quotedAmount: number | null;
  fileCount: number; summary: string | null;
  paymentMethod?: PaymentMethod | null; paymentStatus?: string | null; customerName?: string; customerPhone?: string;
  deliverySlot?: string; deliveryDate?: string; partnerName?: string | null;
}
export interface AppNotification { id: string; type: string; title: string; body: string; read: boolean; createdAt: string; orderId: string | null; orderNumber: string | null }
export interface Partner { id: string; name: string; phone: string; isAvailable: boolean; active: boolean; activeOrders: number; codCollectedToday: number }
