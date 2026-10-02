import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = { Welcome: undefined; Login: undefined; OTP: { phone: string }; Legal: undefined };

export type CustomerTabParamList = { Home: undefined; Orders: undefined; Cart: undefined; Profile: undefined };
export type CustomerStackParamList = {
  Tabs: NavigatorScreenParams<CustomerTabParamList> | undefined;
  Upload: undefined;
  TypeMedicines: undefined;
  Addresses: { select?: boolean } | undefined;
  AddressForm: { addressId?: string } | undefined;
  DeliveryTime: undefined;
  Review: undefined;
  Success: { orderId: string; orderNumber: string };
  OrderDetail: { orderId: string };
  Payment: { orderId: string };
  Notifications: undefined;
  EditProfile: undefined;
  Language: undefined;
  Help: undefined;
  Legal: undefined;
};

export type AdminTabParamList = { Dashboard: undefined; Requests: undefined; Orders: undefined; Team: undefined; More: undefined };
export type AdminStackParamList = {
  Tabs: NavigatorScreenParams<AdminTabParamList> | undefined;
  OrderReview: { orderId: string };
  Customers: undefined;
  Reports: undefined;
  StoreSettings: undefined;
  Language: undefined;
};

export type PartnerStackParamList = { Home: undefined; Job: { orderId: string }; Language: undefined };
