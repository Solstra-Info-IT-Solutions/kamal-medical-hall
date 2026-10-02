import { api } from './client';
import type { Address, AddressInput, AppNotification, Order, OrderSummary, Partner, PaymentMethod, StoreConfig, User } from './types';

export interface RazorpayIntent { orderId: string; amount: number; currency: string; keyId: string }
export interface UploadSignature { cloudName: string; apiKey: string; signature: string; timestamp: number; folder: string; type: string }
export interface NewOrderInput {
  kind: 'prescription' | 'medicines';
  items: { name: string; quantity: number }[];
  prescriptions: { publicId: string; mimeType: string; sizeBytes: number; url: string }[];
  note?: string; addressId: string; deliveryDate: string; deliverySlot: string; idempotencyKey: string;
}

export const endpoints = {
  config: () => api<StoreConfig>('GET', '/config', undefined, { auth: false }),
  devLogin: (phone: string, otp: string) => api<{ token: string }>('POST', '/auth/dev-login', { phone, otp }, { auth: false }),
  session: (token: string) => api<{ user: User; needsProfile: boolean }>('POST', '/auth/session', undefined, { token }),
  me: () => api<{ user: User }>('GET', '/me'),
  deleteAccount: () => api<void>('DELETE', '/me'),
  pincodes: () => api<{ pincodes: string[] }>('GET', '/pincodes', undefined, { auth: false }),
  updateMe: (b: { name?: string; email?: string; language?: 'en' | 'hi' }) => api<{ user: User }>('PATCH', '/me', b),

  addresses: () => api<{ addresses: Address[] }>('GET', '/addresses'),
  addAddress: (b: AddressInput) => api<{ address: Address }>('POST', '/addresses', b),
  updateAddress: (id: string, b: AddressInput) => api<{ address: Address }>('PUT', `/addresses/${id}`, b),
  deleteAddress: (id: string) => api<void>('DELETE', `/addresses/${id}`),

  signUpload: () => api<UploadSignature>('POST', '/uploads/sign'),
  createOrder: (b: NewOrderInput) => api<{ order: Order }>('POST', '/orders', b, { timeoutMs: 30000 }),
  orders: (scope: 'completed' | 'active', offset = 0) => api<{ orders: OrderSummary[]; hasMore: boolean }>('GET', `/orders?scope=${scope}&offset=${offset}`),
  order: (id: string) => api<{ order: Order }>('GET', `/orders/${id}`),
  cancelOrder: (id: string, reason: string) => api<{ order: Order }>('POST', `/orders/${id}/cancel`, { reason }),
  acceptQuote: (id: string, paymentMethod: PaymentMethod) => api<{ order: Order; razorpay: RazorpayIntent | null }>('POST', `/orders/${id}/accept-quote`, { paymentMethod }),
  verifyPayment: (id: string, b: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) => api<{ order: Order }>('POST', `/orders/${id}/payment/verify`, b),

  notifications: () => api<{ notifications: AppNotification[] }>('GET', '/notifications'),
  markAllRead: () => api<void>('POST', '/notifications/read-all'),
  registerDevice: (token: string, platform: 'android' | 'ios') => api<void>('POST', '/devices', { token, platform }),

  admin: {
    dashboard: () => api<{ requested: number; awaitingPayment: number; readyToDispatch: number; outForDelivery: number; deliveredToday: number; salesToday: number }>('GET', '/admin/dashboard'),
    orders: (status?: string, search?: string) => api<{ orders: OrderSummary[] }>('GET', `/admin/orders?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}) })}`),
    quote: (id: string, amount: number) => api<{ order: Order }>('POST', `/admin/orders/${id}/quote`, { amount }),
    reject: (id: string, reason: string) => api<{ order: Order }>('POST', `/admin/orders/${id}/reject`, { reason }),
    cancel: (id: string, reason: string) => api<{ order: Order }>('POST', `/admin/orders/${id}/cancel`, { reason }),
    assign: (id: string, partnerId: string) => api<{ order: Order }>('POST', `/admin/orders/${id}/assign`, { partnerId }),
    partners: () => api<{ partners: Partner[] }>('GET', '/admin/partners'),
    addPartner: (name: string, phone: string) => api<{ id: string }>('POST', '/admin/partners', { name, phone }),
    setPartnerActive: (id: string, active: boolean) => api<void>('PATCH', `/admin/partners/${id}`, { active }),
    pincodes: () => api<{ pincodes: { pincode: string; area: string | null; active: boolean }[] }>('GET', '/admin/pincodes'),
    addPincodes: (pincodes: string[], area?: string) => api<{ added: number }>('POST', '/admin/pincodes', { pincodes, area }),
    setPincodeActive: (pincode: string, active: boolean) => api<void>('PATCH', `/admin/pincodes/${pincode}`, { active }),
    deletePincode: (pincode: string) => api<void>('DELETE', `/admin/pincodes/${pincode}`),
    setPartnerPincodes: (id: string, pincodes: string[]) => api<void>('PUT', `/admin/partners/${id}/pincodes`, { pincodes }),
    customers: (search?: string) => api<{ customers: { id: string; name: string | null; phone: string; joinedAt: string; orderCount: number }[] }>('GET', `/admin/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    reports: (days = 30) => api<{ days: number; daily: { day: string; orders: number; sales: number }[]; paymentSplit: { method: string | null; orders: number; sales: number }[]; perPartner: { name: string; orders: number }[] }>('GET', `/admin/reports?days=${days}`),
    settings: () => api<{ isOpen: boolean; openingTime: string; closingTime: string; address: string | null; phone: string | null; email: string | null }>('GET', '/admin/settings'),
    saveSettings: (b: { isOpen: boolean; openingTime: string; closingTime: string; address: string | null; phone: string | null; email: string | null }) => api<void>('PUT', '/admin/settings', b),
  },
  partner: {
    me: () => api<{ isAvailable: boolean; active: boolean }>('GET', '/partner/me'),
    setAvailable: (available: boolean) => api<{ isAvailable: boolean }>('PUT', '/partner/availability', { available }),
    orders: (scope: 'active' | 'history') => api<{ orders: OrderSummary[] }>('GET', `/partner/orders?scope=${scope}`),
    outForDelivery: (id: string) => api<{ order: Order }>('POST', `/partner/orders/${id}/out-for-delivery`),
    delivered: (id: string, cashCollected: boolean) => api<{ order: Order }>('POST', `/partner/orders/${id}/delivered`, { cashCollected }),
  },
};
