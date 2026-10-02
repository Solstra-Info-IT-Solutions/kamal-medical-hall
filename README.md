# Kamal Medical Hall

Medical-shop delivery app for one pharmacy in Mansarovar, Jaipur.

| Folder | What it is |
| --- | --- |
| `mobile/` | Expo / React Native app (Android + iOS). One app, three experiences chosen by the server-assigned role: **customer**, **store admin**, **delivery partner**. |
| `backend/` | Node.js + Express + TypeScript API on Supabase Postgres. Verifies Firebase phone-auth tokens, Cloudinary upload signatures, Razorpay payments. |
| `REQUIREMENTS.md`, `APP_FLOWS.md` | Confirmed requirements and role flows. |

## Run locally (no external accounts needed)

```bash
# 1. API (uses AUTH_MODE=dev: OTP is 123456; never allowed when NODE_ENV=production)
cd backend && npm install && npm run dev        # http://localhost:4000

# 2. App (web preview or a dev build)
cd mobile && npm install && npm run web
```

Dev accounts (dev auth mode only): customer = any new number, admin `9000000001`, delivery staff `9000000002`, `9000000003`. OTP `123456`.

## Going live – what must be supplied

1. **Firebase**: create a project, enable *Phone* sign-in, add an Android app (`com.kamalmedicalhall.preview` until final ids are chosen) and an iOS app. Put `google-services.json` and `GoogleService-Info.plist` in `mobile/`. In `backend/.env` set `AUTH_MODE=firebase`, `FIREBASE_PROJECT_ID` and (for push) `FIREBASE_SERVICE_ACCOUNT_JSON`.
2. **Cloudinary**: `CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET` in `backend/.env`.
3. **Razorpay**: `RAZORPAY_KEY_ID / KEY_SECRET / WEBHOOK_SECRET`; set the webhook URL to `https://<api-host>/webhooks/razorpay` (events `payment.captured`, `order.paid`).
4. **Hosting** for `backend/` (any Node 20+ host), then set `EXPO_PUBLIC_API_URL` for the app build.
5. Store details (address, phone, hours) via the admin app → *More → Store settings*.
