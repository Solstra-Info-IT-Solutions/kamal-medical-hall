# Kamal Medical Hall — Requirements

**Status:** Discovery and implementation in progress  
**Source of truth:** This document records client-confirmed requirements, engineering recommendations, and unresolved decisions. Recommendations are not production business rules until accepted.

## 1. Confirmed requirements

### Business
- Official name: Kamal Medical Hall (कमल मेडिकल हॉल).
- One pharmacy branch, located in Mansarovar, Jaipur.
- Pharmacy branch remains in Mansarovar, Jaipur. Delivery eligibility uses the client-supplied Jaipur district pincode allowlist below.
- Supported delivery pincodes: see `mobile/src/constants/serviceArea.ts` (client supplied 135 codes).
- Other official contact details and working hours remain to be supplied.
- Brand tagline from the brief: “Your Trusted Healthcare Partner” / “आपके स्वास्थ्य का विश्वसनीय साथी”.

### Platform and customer experience
- Build for both iOS and Android.
- Mobile OTP sign-in is required.
- The customer app must support English and Hindi.
- Main tabs: Home, Orders, Cart, Profile.
- The reference image guides the visual direction and customer flow; UI must be built from interactive native components.
- Client has a logo/icon asset and will provide it separately.
- Customer address book supports multiple saved addresses, GPS-based prefill, and the client-supplied Jaipur pincode allowlist. The exact map display/provider and additional address fields remain open.

### Catalogue and prescription workflow
- An existing medicine catalogue is available; its data/API contract has not yet been provided.
- Customers can add items to a cart and submit an order for pharmacy review.
- Prescription uploads must support camera, gallery, and PDF.
- Maximum prescription uploads per order: 3 files.
- Prescription-only and catalogue-medicine-only orders are separate; the two types must not be mixed in one cart/order.
- Delivery slots: six daily windows, 9:00 AM–11:00 AM, 11:00 AM–1:00 PM, 1:00 PM–3:00 PM, 3:00 PM–5:00 PM, 5:00 PM–7:00 PM, and 7:00 PM–9:00 PM. Date examples in the supplied JSON are dynamic sample dates, not fixed calendar dates.
- Payment methods available for each order: Razorpay and Cash on Delivery (COD). Gateway/account setup and COD collection details remain open.
- Customer order history should show completed orders only.
- Customer cancellations are made from order details and require a reason. The store confirmed cancellation is allowed only before the order goes out for delivery. No refund policy exists; the app must not promise refunds.
- An admin/pharmacist reviews prescriptions. If one is rejected, the customer receives a notification.
- The order amount is determined after admin review and shown to the customer. The customer must accept the pharmacy's amount before payment.
- The app must state that prescription medicines are checked by the pharmacy before fulfillment and must not imply automatic approval.

### Backend and integrations
- A backend and admin capability need to be created; no existing API/backend documentation was supplied.
- The supplied PRD (Medical-Shop-App-PRD.docx) defines Customer, Store Admin, and Delivery Partner roles and includes system, order sequence/status, customer, admin, payment, and partner diagrams. Later client decisions take precedence where they differ: Razorpay and COD instead of the PRD's store QR/UPI option, both mobile platforms, the supplied pincode list, free delivery, mandatory acceptance of the pharmacy quote, completed-only customer order history, cancellation reason, and role-routed app experiences.
- Prescription files should be stored in Cloudinary. Account/configuration, access controls, and retention period remain open.
- Firebase is requested for notifications/integrations; exact Firebase products and events remain open.
- Legal policy documents will be supplied by the client. Until then, legal screens may be placeholders and must not contain invented policy claims.
- Target publishing platforms: Google Play and Apple App Store. Package/bundle identifiers and store account details remain open.

## 2. Engineering decisions and recommendations

- Cross-platform app: React Native + TypeScript. Recommend Expo unless required native capabilities or existing constraints call for React Native CLI.
- OTP: use React Native Firebase Phone Authentication (`@react-native-firebase/auth`) for native iOS and Android, based on the client's instruction to choose the best OTP option and requested Firebase integration. Expo requires native config plugins and a development build. Use Firebase's provider-managed controls unless the client specifies custom OTP rules; verify project setup and billing before production.
- Mobile architecture: React Navigation, Zustand, AsyncStorage for non-sensitive preferences/cart, React Hook Form + Zod, and repository interfaces with asynchronous mock implementations until backend contracts are available.
- Backend: create a separately deployable API with a relational database, role-based customer/admin access, and repository/service boundaries. Framework, database, and hosting choice still need confirmation or delegated selection before implementation. Verify Firebase ID tokens on protected customer requests; never trust a client-supplied UID without token verification.
- Cloudinary: upload through a backend-issued, restricted signature or equivalent server-mediated flow; do not embed privileged Cloudinary credentials in the app.
- Firebase: likely Cloud Messaging for push and Analytics/Crashlytics if desired; confirm which are in scope.
- Treat medicine price, stock, prescription decisions, delivery eligibility, and order status as server-authoritative.

### Decisions already applied
- Expo + TypeScript starter selected for the cross-platform foundation; React Navigation is installed for the requested customer flow.
- App structure, central theme tokens, bilingual JSON resources, i18next setup, language persistence, typed routes, and initial Home/Orders/Cart/Profile tabs have been started under `mobile/`.
- Mobile-number and OTP screens, a typed auth repository boundary, navigation gating, and a Zustand session store are implemented. The current asynchronous mock OTP (`123456`) is development-only; no SMS is sent.
- Temporary starter icon/splash remain in place pending delivery of the client's logo and app icon.
- Final iOS/Android application identifiers have intentionally not been assigned pending the client's publishing details.
- Mobile login and six-digit OTP screens are implemented against an explicitly development-only asynchronous mock. The mock code (`123456`) is shown only in development builds and never sends an SMS. Production login still requires Firebase project setup and native configuration files.

### Current implementation status
- Phase 1 foundation and the initial login/OTP UI are in place.
- The app can enter the mock authenticated state and navigate to the first-stage Home/Orders/Cart/Profile experience.
- Prescription photo selection (camera/gallery), PDF selection, previews, removal, and 5 MB per-file validation are implemented using the supplied screenshot's visible limit. The confirmed maximum is 3 files per order.
- Medicine search uses an asynchronous sample repository with debounced search; all listed products have no price and are labelled sample data.
- Cart supports either catalogue medicines or prescription files, not both in the same order; switching requires customer confirmation. Prescription URIs remain in memory only and are not uploaded to Cloudinary yet.
- Address list/selection/add/edit are implemented with validation for Indian mobile numbers and the Jaipur allowlist. Addresses are persisted with Expo SecureStore. User-triggered GPS reverse geocoding prefills address fields.
- First customer login requests a full name and optional email; profile edit keeps the verified phone read-only.
- Role-aware navigation and development-only demo phone accounts for customer/admin/partner flows are implemented against a shared in-memory mock operations store. Demo phones are 9876543210 (customer), 9000000001 (admin), and 9000000002/9000000003 (delivery staff); OTP is 123456. Production must receive authorized role claims and all orders/updates from the backend; demo accounts and sample orders are not production behavior.
- Admin preview includes dashboard, incoming request review/quote/rejection, order list, payment-confirmation preview, delivery staff availability/assignment, and linked partner flow. Partner preview supports availability, assignment details, call/maps launch, out-for-delivery, delivery completion, and COD cash confirmation.
- Customer notifications link to order details; quote acceptance and cancellation-reason UI are implemented in the mock flow. Customer order history is filtered to completed/delivered orders only. Customer cancellation is limited to before out-for-delivery and requires a reason of at least five characters.
- The store confirmed there is no refund policy. Customer-facing flows must not promise refunds. Razorpay settlement/reversal handling for any canceled paid order still requires backend/business handling before production.
- Customer checkout now connects cart → saved address → runtime-generated four-day date choices and six Jaipur-time delivery windows → review → mock request submission/confirmation. Production order submission, payment, live backend notifications, and server-backed admin/customer/report/settings data remain in progress. Razorpay is not connected.
- TypeScript strict check and Expo public config resolution currently pass.

## 3. Open questions / decisions needed

### Business details
- Official pharmacy address, phone, email, and working hours.
- Whether additional radius/availability checks apply beyond the confirmed pincode allowlist.

### Login and customer profile
- Firebase Phone Authentication is the selected provider. Firebase project configuration is still required for the native integration.
- Customer profile: full name is required, email is optional per the PRD, and the verified phone is the login identifier. Exact address fields and map display/provider remain open. GPS capture is an opt-in address form action.

### Catalogue, cart, and prescription review
- Catalogue source and format (API, database export, admin software); medicine search fields and sample data/API contract.
- Whether users may request medicines that are not in the catalogue.
- Quantity limits and stock behavior.
- Pharmacist clarification/re-upload flow and prescription retention period. The current app applies a 5 MB per-file limit from the reference screenshot and 3 files per order from the client.
- Exact order status transitions, handling of store-initiated cancellation, Razorpay payment handling if an already-paid order is canceled, quote expiry, and what happens if the customer declines or does not respond. Customer cancellation cutoff is confirmed as before out-for-delivery.

### Delivery and payment
- Service area: one Mansarovar, Jaipur branch; the client-supplied Jaipur pincode list is the delivery allowlist and is enforced during address entry.
- Delivery is free. Two or three pharmacy staff members deliver orders. Delivery slots are 9–11 AM, 11 AM–1 PM, 1–3 PM, 3–5 PM, 5–7 PM, and 7–9 PM. The supplied date labels were illustrative; calendar dates should be generated at runtime. Minimum-order rules and handling unavailable slots remain open.
- Payment methods confirmed: Razorpay and Cash on Delivery are available for each order. Razorpay account/configuration, retry/failure behavior, COD collection evidence, and payment failure policy remain open. The store says there is no refund policy; do not promise refunds. Customer acceptance of final quoted price happens before paying.
- Pharmacy review can determine the payable amount and the customer receives a popup/notification. The customer must explicitly accept the final quoted amount before proceeding to payment. Whether/how prices or quantities may change remains open.
- Prescription files and catalogue medicines cannot be combined in one order. Switching order type requires an explicit confirmation before clearing the current cart.
- Customer order-history tab shows delivered/completed orders only; cancelled and rejected orders stay out of that history and are visible in notifications/order details.
- Customers may cancel from order details by submitting a required reason, only before the order goes out for delivery. No refund policy is provided; customer-facing copy must not promise refunds.
- Prescription upload maximum: 3 files per order (camera/gallery/PDF); current reference-based file size limit remains 5 MB per file.
- Profile currently supports an editable name and displays the verified login mobile number as read-only; additional profile fields remain unspecified.

### Backend, admin, and operations
- The PRD assumes a web admin panel, but the client requests role-based app entry: after OTP, the server must resolve the verified phone number as customer, store admin, or delivery partner and open that role's experience. Admin and partner roles must be provisioned by the server; the mobile app must not treat a phone number alone as authorization.
- Admin flow based on the PRD: dashboard → incoming requests → review prescription/medicine availability → set and send final quote or reject with a reason → verify payment when applicable → assign an available store delivery partner → update/monitor order → view customers, reports, and store settings.
- Delivery partner flow based on the PRD: OTP login → set available/busy → receive assigned order → view address/contact and open call/maps actions → mark out for delivery → confirm delivery and COD cash collection where applicable → return to available.
- The PRD assumes a web admin panel; the current client-directed preview is an admin app flow. Whether a separate responsive web panel is also required remains to be confirmed. Exact permissions for prescription review, quote changes, payment exceptions, store-initiated cancellation, and order status transitions remain open.
- Backend framework/database/hosting preference, or approval to use recommended options.
- API authentication and endpoints/contracts to define for auth, profile, catalogue/search, upload, cart/order submission, admin review, payment, delivery/address, and notifications.
- Cloudinary account/configuration and access/retention policy.
- Firebase project configuration is being created by the client and will be supplied. Confirm push/in-app, SMS/email/WhatsApp channels, and whether Analytics and Crashlytics are required when project setup is shared.

### Legal and publishing
- Privacy policy, terms, refund/cancellation/delivery policy, and pharmacy disclaimer when available.
- App display name, Android application ID, iOS bundle ID, and app icon/splash assets.

## 4. Initial screen list

1. Welcome/splash
2. Mobile login
3. OTP verification
4. Home
5. Prescription upload
6. Medicine search and selection
7. Cart
8. Address list/selection and add/edit address
9. Delivery date/time selection
10. Payment method
11. Order review
12. Price approval/payment prompt after pharmacy review
13. Order placed/status confirmation
14. Order list and order details/tracking
15. Notifications
16. Profile and settings (including language)
17. Legal placeholder screens until client policies arrive
18. Shared loading, empty, offline, and error states

## 5. Initial user/navigation flow

```text
Welcome → Mobile login → OTP → Home
                           ├─ Upload prescription ─┐
                           └─ Search medicines ─────┴→ Cart
→ Address → Delivery date/time → Submit for pharmacy review
→ Pharmacy reviews prescription/order and sets payable amount
→ Customer receives notification and reviews amount
→ Customer accepts the quoted amount
→ Customer pays using Razorpay or selects COD
→ Order status/details → Orders
```

Delivery is free and fulfilled by two or three store staff. Customer order history displays completed orders only.

The PRD describes three role journeys. The client’s latest instruction makes role selection automatic from the verified account: customer opens the customer app, store admin opens the admin experience, and an assigned delivery partner opens the partner experience. During development, role previews may be provided for UI review; production role assignment must come from authenticated server data.

```text
Admin: OTP → Dashboard → New requests → Review stock/prescription → Send quote or reject
      → Confirm customer acceptance/payment → Assign available staff → Monitor delivery
      → Orders / Payments / Customers / Reports / Settings

Delivery partner: OTP → Availability → Assigned order → Address/contact/map
      → Out for delivery → Delivered (record COD collection when applicable) → Available
```

Bottom tabs: Home, Orders, Cart, Profile. Checkout and detail screens are pushed routes; authentication gates the customer app.

## 6. Initial architecture

### Mobile app
- React Native + TypeScript, with feature-oriented screens/components and centralized theme/localization.
- Navigation: root auth/app switch, four-tab navigator, and stack routes for upload, search, checkout, order detail, notifications, and settings.
- State: auth/session, profile, cart, addresses, checkout, orders, notifications, and locale; persist only appropriate non-sensitive state.
- Screens depend on repository interfaces, not HTTP details. Async mock repositories support development until real API contracts are agreed.
- Localization: English and natural Hindi resources; no user-facing strings hard-coded in components.

### Backend and admin (to be designed after decisions/contracts)
- Customer-facing API and protected admin operations.
- Server-authoritative catalogue/stock, prescription review, pricing, order lifecycle, address/service-area validation, and payment state.
- Cloudinary storage integration for sensitive prescription documents.
- Firebase notification integration only for confirmed channels/events.

## 7. Initial data model outline

`User`, `Address`, `Medicine`, `CartItem`, `PrescriptionFile`, `Order`, `OrderItem`, `DeliverySlot`, `Payment`, `Notification`, and `AdminUser`.

Exact fields, statuses, and transitions are pending business rules/API design. Avoid embedding a guessed lifecycle into production logic.

## 8. Security and quality requirements

- Never place OTPs, private keys, or privileged API/Cloudinary secrets in the mobile app.
- Use role-based authorization for customer and admin actions; protect prescription access and define retention/deletion behavior.
- Do not claim an order is placed/paid until the backend confirms it.
- Localize and validate forms; provide accessible controls and clear loading/error/empty/offline states.
- Production readiness, API contracts, deployment environments, and compliance depend on resolving the open questions above.

## 9. Delivery phases

1. Confirm business rules, API/backend choices, legal inputs, and integration accounts.
2. Establish mobile/backend foundations, design system, navigation, localization, and repository contracts.
3. Implement authentication, home, catalogue, prescription upload, and cart.
4. Implement admin review, pricing approval, addresses, delivery, payment, and order lifecycle against agreed contracts.
5. Add profile/settings/notifications, offline behavior, accessibility, and production configuration.
6. Validate iOS/Android builds and agreed scenarios; prepare store metadata after identifiers/assets are supplied.


## 11. Decisions confirmed 2 Oct 2026 (client: "go with your recommendations")

- **Medicine entry**: customers type free-text medicine names with quantities (as in the supplied design and the PRD). No catalogue search until a catalogue is supplied.
- **OTP**: 6 digits (Firebase Phone Auth length) although the mock-up shows 5 boxes.
- **Payment order**: request → pharmacy quote → customer accepts → chooses Razorpay or COD. The mock-up's UPI-QR/screenshot flow is replaced by Razorpay.
- **Default language**: Hindi (English selectable in Profile → Language).
- **Delivery slots**: today's slots that start less than `MIN_LEAD_MINUTES` (60) from now are unavailable; dates computed on the server in Asia/Kolkata. Quotes are valid `QUOTE_VALID_HOURS` (24). Both are placeholders awaiting store policy.
- **Backend**: Node.js + Express + TypeScript on Supabase Postgres (project `kamal-medical-hall`, Mumbai). Row-level security is enabled on every table with no public policies; only the API's database role can read/write.
- **Admin / partner UI**: built in the same app with the same design tokens (no separate designs were supplied).
- **Not built**: voice input (mic icon in the mock-up) – needs a native speech module; live partner location (PRD Phase 2).
