# Kamal Medical Hall mobile app

Cross-platform React Native app for Kamal Medical Hall, built with Expo and TypeScript for iOS and Android.

## Current foundation

- React Navigation stack with Home, Orders, Cart, and Profile tabs.
- Centralized healthcare palette, spacing, and type scale.
- English and Hindi resources through `i18next` and `react-i18next`.
- Device-language selection on first launch and saved language preference.
- Typed navigation routes for the agreed customer journey.
- Initial Home screen inspired by the supplied reference.
- Mobile number and OTP screens with local validation and loading/error feedback.
- Prescription camera/gallery/PDF selection with local preview, removal, and the reference image's 5 MB per-file check.
- Debounced medicine search backed by asynchronous sample data.
- Zustand cart with quantity edits and locally persisted catalogue items; prescription URIs stay in memory only.
- Address book with validated add/select/remove/default actions, encrypted persistence through Expo SecureStore, and user-triggered GPS address prefill.
- First-customer-login setup (full name required, email optional), editable profile, and editable addresses; address pincode must belong to the configured Jaipur service allowlist.
- Separate customer, admin, and delivery-partner navigation experiences. Development-only demo phone accounts route by number: 9876543210 (customer), 9000000001 (admin), and 9000000002 / 9000000003 (delivery partner). The mock OTP is 123456; production routing must use server-authorized role claims.
- Admin request review, quote/rejection reasons, payment-confirmation preview, order views, store delivery-team availability, and partner assignment against mock orders.
- Partner availability, assigned-order detail, phone/maps actions, delivery-status updates, and COD-cash confirmation against the mock operations store.
- Customer quote acceptance, Razorpay/COD choice, cancellation from order details with a required reason, notification-linked active-order details, and completed-only order history.
- Customer checkout through saved address, four runtime-generated delivery dates, six Asia/Kolkata delivery slots, order review, and a local mock request confirmation.
- Development-only mock OTP flow (`123456`); it does not send SMS and is not production authentication.

Role flows currently use mock orders in a shared in-memory Zustand store. They are for reviewing journeys and must be replaced with authenticated API operations. Firebase role claims, Razorpay payment creation/verification, Cloudinary upload, backend order submission and notifications are not wired yet. The payment confirmation action is development-only. The web admin panel described in the PRD is represented as a role-gated mobile admin experience per the client's latest request. Live map navigation uses a Google Maps URL, and live location tracking is out of MVP scope. Customers can cancel before an order goes out for delivery, with a required reason; the store has no refund policy and the app does not promise refunds. The template icon and splash art are temporary until the supplied brand assets are added.

## Requirements

- Node.js version supported by the installed Expo SDK (see [Expo SDK reference](https://docs.expo.dev/versions/latest/)).
- npm.
- Android Studio/emulator or Android device for Android builds.
- macOS with Xcode for native iOS builds; EAS Build can build iOS from supported non-macOS environments.

## Install and run

```sh
npm install
npm start
```

This starter uses Expo Development Builds. Build a native development client before the first device run:

```sh
npm run android
npm run ios
```

Native iOS simulator builds require macOS and Xcode.

### Android APK preview

The `preview` EAS profile is configured to produce an installable APK:

```sh
eas build --platform android --profile preview
```

This cloud build uploads the app source to Expo EAS. The Android application ID is still provisional until the store publishing identifiers are chosen.

## Configuration

Copy `.env.example` to a local environment file when an API is available. Never commit credentials or private keys. Firebase and Cloudinary project configuration will be connected after their client projects and backend contracts are supplied.

## Localization

Translation resources live in `src/localization/en/common.json` and `src/localization/hi/common.json`. Add all customer-facing text to both files. `src/localization/index.ts` restores the saved language or selects Hindi when the device language is Hindi.

## Architecture

```text
src/
  localization/   i18next setup and English/Hindi resources
  navigation/     typed root stack and bottom tabs
  theme/          colors, spacing, typography
  types/          navigation and domain types
```

`APP_FLOWS.md` at the repository root describes the customer, store admin, and delivery-partner journeys. `REQUIREMENTS.md` tracks confirmed decisions and remaining production setup. The current async mock OTP code is `123456`; demo phone accounts are visible only in development builds.

## Known setup items

- Add the client's logo, app icon, and splash assets.
- Set the final iOS bundle identifier and Android application ID after the client provides/chooses them.
- Connect Firebase Phone Auth and notification products after Firebase project configuration is available.
- Connect the backend and Cloudinary only through approved server-side contracts; no privileged credentials belong in the app.
