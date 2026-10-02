import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, View } from 'react-native';
import { Icon, type IconName } from '../components/ui';
import { LoginScreen, OtpScreen, SignupScreen, WelcomeScreen } from '../screens/auth/AuthScreens';
import { AllOrdersScreen, CustomersScreen, DashboardScreen, MoreScreen, OrderReviewScreen, ReportsScreen, RequestsScreen, StoreSettingsScreen, TeamScreen } from '../screens/admin/AdminScreens';
import { AddressFormScreen, AddressesScreen } from '../screens/customer/AddressScreens';
import { CartScreen } from '../screens/customer/CartScreen';
import { DeliveryTimeScreen, ReviewScreen, SuccessScreen } from '../screens/customer/CheckoutScreens';
import { HomeScreen } from '../screens/customer/HomeScreen';
import { TypeMedicinesScreen, UploadScreen } from '../screens/customer/OrderInputScreens';
import { NotificationsScreen, OrderDetailScreen, OrdersScreen, PaymentScreen } from '../screens/customer/OrderScreens';
import { EditProfileScreen, HelpScreen, LanguageScreen, LegalScreen, ProfileScreen } from '../screens/customer/ProfileScreens';
import { JobScreen, PartnerHomeScreen } from '../screens/partner/PartnerScreens';
import { useCart } from '../store/cart';
import { useSession } from '../store/session';
import { colors, fonts } from '../theme';
import type { AdminStackParamList, AdminTabParamList, AuthStackParamList, CustomerStackParamList, CustomerTabParamList, PartnerStackParamList } from './types';

const logo = require('../../assets/logo.png');

const headerOptions = {
  headerTitleAlign: 'center' as const,
  headerShadowVisible: false,
  headerTintColor: colors.text,
  headerTitleStyle: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  headerBackButtonDisplayMode: 'minimal' as const,
  contentStyle: { backgroundColor: colors.white },
};

const tabOptions = {
  headerShown: false,
  tabBarActiveTintColor: colors.primary,
  tabBarInactiveTintColor: colors.secondary,
  tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
  tabBarStyle: { height: 66, paddingTop: 6, paddingBottom: 8, borderTopColor: colors.border },
};
const tabIcon = (name: IconName, focusedName: IconName) => ({ color, focused }: { color: string; focused: boolean }) => <Icon name={focused ? focusedName : name} size={25} color={color} />;

const Auth = createNativeStackNavigator<AuthStackParamList>();
function AuthNavigator() {
  const { t } = useTranslation();
  return (
    <Auth.Navigator screenOptions={{ ...headerOptions, headerShown: false }}>
      <Auth.Screen name="Welcome" component={WelcomeScreen} />
      <Auth.Screen name="Login" component={LoginScreen} />
      <Auth.Screen name="OTP" component={OtpScreen} />
      <Auth.Screen name="Legal" component={LegalScreen} options={{ headerShown: true, title: t('legal.title') }} />
    </Auth.Navigator>
  );
}

const CTabs = createBottomTabNavigator<CustomerTabParamList>();
function CustomerTabs() {
  const { t } = useTranslation();
  const count = useCart((s) => s.medicines.length + s.prescriptions.length);
  return (
    <CTabs.Navigator screenOptions={tabOptions}>
      <CTabs.Screen name="Home" component={HomeScreen} options={{ title: t('tabs.home'), tabBarIcon: tabIcon('home-outline', 'home') }} />
      <CTabs.Screen name="Orders" component={OrdersScreen} options={{ title: t('tabs.orders'), tabBarIcon: tabIcon('document-text-outline', 'document-text') }} />
      <CTabs.Screen name="Cart" component={CartScreen} options={{ title: t('tabs.cart'), tabBarBadge: count || undefined, tabBarIcon: tabIcon('cart-outline', 'cart') }} />
      <CTabs.Screen name="Profile" component={ProfileScreen} options={{ title: t('tabs.profile'), tabBarIcon: tabIcon('person-outline', 'person') }} />
    </CTabs.Navigator>
  );
}

const CStack = createNativeStackNavigator<CustomerStackParamList>();
function CustomerNavigator() {
  const { t } = useTranslation();
  return (
    <CStack.Navigator screenOptions={headerOptions}>
      <CStack.Screen name="Tabs" component={CustomerTabs} options={{ headerShown: false }} />
      <CStack.Screen name="Upload" component={UploadScreen} options={{ title: t('screens.upload') }} />
      <CStack.Screen name="TypeMedicines" component={TypeMedicinesScreen} options={{ title: t('screens.typeMedicines') }} />
      <CStack.Screen name="Addresses" component={AddressesScreen} options={{ title: t('screens.address') }} />
      <CStack.Screen name="AddressForm" component={AddressFormScreen} options={{ title: t('screens.addressForm') }} />
      <CStack.Screen name="DeliveryTime" component={DeliveryTimeScreen} options={{ title: t('screens.time') }} />
      <CStack.Screen name="Review" component={ReviewScreen} options={{ title: t('screens.review') }} />
      <CStack.Screen name="Success" component={SuccessScreen} options={{ headerShown: false, gestureEnabled: false }} />
      <CStack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: t('screens.orderDetail') }} />
      <CStack.Screen name="Payment" component={PaymentScreen} options={{ title: t('screens.payment') }} />
      <CStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: t('home.notifications') }} />
      <CStack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: t('profile.edit') }} />
      <CStack.Screen name="Language" component={LanguageScreen} options={{ title: t('profile.language') }} />
      <CStack.Screen name="Help" component={HelpScreen} options={{ title: t('profile.help') }} />
      <CStack.Screen name="Legal" component={LegalScreen} options={{ title: t('legal.title') }} />
    </CStack.Navigator>
  );
}

const ATabs = createBottomTabNavigator<AdminTabParamList>();
function AdminTabs() {
  const { t } = useTranslation();
  return (
    <ATabs.Navigator screenOptions={tabOptions}>
      <ATabs.Screen name="Dashboard" component={DashboardScreen} options={{ title: t('admin.dashboard'), tabBarIcon: tabIcon('grid-outline', 'grid') }} />
      <ATabs.Screen name="Requests" component={RequestsScreen} options={{ title: t('admin.newRequests'), tabBarIcon: tabIcon('mail-unread-outline', 'mail-unread') }} />
      <ATabs.Screen name="Orders" component={AllOrdersScreen} options={{ title: t('tabs.orders'), tabBarIcon: tabIcon('document-text-outline', 'document-text') }} />
      <ATabs.Screen name="Team" component={TeamScreen} options={{ title: t('admin.team'), tabBarIcon: tabIcon('people-outline', 'people') }} />
      <ATabs.Screen name="More" component={MoreScreen} options={{ title: t('admin.more'), tabBarIcon: tabIcon('menu-outline', 'menu') }} />
    </ATabs.Navigator>
  );
}
const AStack = createNativeStackNavigator<AdminStackParamList>();
function AdminNavigator() {
  const { t } = useTranslation();
  return (
    <AStack.Navigator screenOptions={headerOptions}>
      <AStack.Screen name="Tabs" component={AdminTabs} options={{ headerShown: false }} />
      <AStack.Screen name="OrderReview" component={OrderReviewScreen} options={{ title: t('screens.orderDetail') }} />
      <AStack.Screen name="Customers" component={CustomersScreen} options={{ title: t('admin.customers') }} />
      <AStack.Screen name="Reports" component={ReportsScreen} options={{ title: t('admin.reports') }} />
      <AStack.Screen name="StoreSettings" component={StoreSettingsScreen} options={{ title: t('admin.settings') }} />
      <AStack.Screen name="Language" component={LanguageScreen} options={{ title: t('profile.language') }} />
    </AStack.Navigator>
  );
}

const PStack = createNativeStackNavigator<PartnerStackParamList>();
function PartnerNavigator() {
  const { t } = useTranslation();
  return (
    <PStack.Navigator screenOptions={headerOptions}>
      <PStack.Screen name="Home" component={PartnerHomeScreen} options={{ headerShown: false }} />
      <PStack.Screen name="Job" component={JobScreen} options={{ title: t('screens.orderDetail') }} />
      <PStack.Screen name="Language" component={LanguageScreen} options={{ title: t('profile.language') }} />
    </PStack.Navigator>
  );
}

/** Customers must have a name on file before reaching the app (first-login signup). */
function CustomerGate() {
  const needsName = useSession((s) => !s.user?.name);
  return needsName ? <SignupScreen /> : <CustomerNavigator />;
}

const linking: LinkingOptions<object> = { prefixes: ['kamalmedicalhall://'] };

export function Navigation() {
  const status = useSession((s) => s.status);
  const role = useSession((s) => s.user?.role);
  const bootstrap = useSession((s) => s.bootstrap);
  useEffect(() => { void bootstrap(); }, [bootstrap]);

  if (status === 'loading') {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white }}><Image source={logo} style={{ width: 220, height: 220 }} resizeMode="contain" /><ActivityIndicator color={colors.primary} /></View>;
  }
  return (
    <NavigationContainer linking={linking}>
      {status === 'out' ? <AuthNavigator /> : role === 'admin' ? <AdminNavigator /> : role === 'delivery_partner' ? <PartnerNavigator /> : <CustomerGate />}
    </NavigationContainer>
  );
}
