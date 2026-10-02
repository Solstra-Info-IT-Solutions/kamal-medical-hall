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
  store: { isOpen: boolean; openingTime: string; closingTime: string; address: string | null; phone: string | null; email: string | null; latitude: number | null; longitude: number | null };
  deliveryDays: DeliveryDay[];
  authMode: 'dev' | 'firebase';
}

export interface Order {
  id: string; orderNumber: string; kind: OrderKind; status: OrderStatus; note: string | null;
  address: { recipientName: string; phone: string | null; line1: string; line2?: string; landmark?: string; pincode: string; city: string; latitude?: number; longitude?: number };
  deliveryDate: string; deliverySlot: string; quotedAmount: number | null; quoteExpiresAt: string | null;
  paymentMethod: PaymentMethod | null; paymentStatus: string | null; rejectionReason: string | null; cancelReason: string | null;
  createdAt: string;
  items: { id: string; name: string; quantity: number }[];
  prescriptions: { id: string; mimeType: string; sizeBytes: number | null; url: string | null; name?: string }[];
  history: { status: OrderStatus; reason: string | null; created_at: string }[];
  deliveredAt: string | null;
  /** The bill the store attached to the amount request (not shown to delivery partners). */
  bill: { name: string; mimeType: string; sizeBytes: number | null; uploadedAt: string | null; viewUrl: string | null; downloadUrl: string | null } | null;
  store: { name: string; address: string | null; phone: string | null };
  customer?: { id: string; name: string | null; phone: string | null };
  /** Delivery partner has accepted the assignment (customers only see the partner after this). */
  partnerAccepted: boolean;
  /** Delivery partners: whether the store lets them see/call the customer's number. */
  canCallCustomer: boolean;
  partner: { id: string; name: string | null; phone?: string } | null;
}
export interface OrderSummary {
  id: string; orderNumber: string; kind: OrderKind; status: OrderStatus; createdAt: string; quotedAmount: number | null;
  fileCount: number; summary: string | null;
  paymentMethod?: PaymentMethod | null; paymentStatus?: string | null; customerName?: string; customerPhone?: string;
  deliverySlot?: string; deliveryDate?: string; partnerName?: string | null;
  partnerAccepted?: boolean; pincode?: string | null; rejectedReason?: string; respondedAt?: string;
}
export interface AppNotification { id: string; type: string; title: string; body: string; read: boolean; createdAt: string; orderId: string | null; orderNumber: string | null }
export type PartnerState = 'off' | 'available' | 'reserved' | 'busy' | 'returning' | 'break';
export type DutyStatus = 'on_duty' | 'off_duty' | 'on_break' | 'leave';
export type DayStatus = 'present' | 'leave' | 'paid_leave' | 'absent';
export interface Partner {
  id: string; name: string; phone: string; active: boolean; state: PartnerState; isAvailable: boolean; onDuty: boolean;
  dutyStatus: DutyStatus | 'absent'; paidLeave: boolean; breakMinutes: number;
  canCallCustomer: boolean; checkedInAt: string | null; checkedOutAt: string | null; lastSeen: string | null;
  activeOrders: number; deliveredToday: number; codCollectedToday: number; pincodes: string[];
}
export interface Attendance {
  dates: string[];
  closedDays: string[];
  today: { id: string; name: string; phone: string; state: PartnerState; dutyStatus: DutyStatus | 'absent'; paidLeave: boolean; present: boolean; notIn: boolean; checkedInAt: string | null; checkedOutAt: string | null; breakMinutes: number }[];
  summary: { total: number; present: number; onDuty: number; onBreak: number; offDuty: number; onLeave: number; absent: number; available: number; busy: number };
  history: { id: string; name: string; days: (DayStatus | null)[] }[];
}
export interface PartnerAttendance {
  days: { day: string; status: DayStatus; checkedInAt: string | null; checkedOutAt: string | null; breakMinutes: number }[];
  closedDays: string[];
  summary: { present: number; leave: number; paidLeave: number; absent: number };
}
export interface Terms { text: string; updatedAt: string | null }
export interface Tracking {
  orderId: string; orderNumber: string; status: OrderStatus;
  store: { lat: number; lng: number } | null; destination: { lat: number; lng: number } | null;
  partner: { name: string | null } | null; rider: { lat: number; lng: number; updatedAt: string } | null; etaMinutes: number | null;
}
export interface PaymentDetails {
  upiId: string | null; upiName: string | null; bankName: string | null; bankAccountName: string | null; bankAccountNumber: string | null; bankIfsc: string | null;
}
export interface StoreSettings {
  isOpen: boolean; openingTime: string; closingTime: string; address: string | null; phone: string | null; email: string | null;
  latitude: number | null; longitude: number | null; geofenceM: number;
}
