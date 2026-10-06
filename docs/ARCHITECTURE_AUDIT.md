# Kamal Medical Hall: Architecture, Performance and Security Audit

Written before any refactoring began (7 Oct 2026). Section 14 records what was then implemented and what is still planned.

## 1. Executive summary

The product works end to end (customer, store admin, delivery partner, web admin) and has a sound security core: every authorisation decision is made on the server, input is validated with zod, SQL is parameterised, prices are set only by the store, payments are verified with HMAC signatures, uploads are signed server-side, and secrets live on the server.

What holds it back from "enterprise" is not a missing feature but four things:

1. **Latency is dominated by hosting, not code.** Measured against production, the first request after idle took **53 s** (Render free instance sleeping). Warm requests take 330–630 ms for a trivial endpoint. API (Render, Singapore) and database (Supabase, Mumbai) are in different regions, so every sequential query costs one cross-region round trip.
2. **The mobile network layer is minimal.** One `fetch` wrapper: no request de-duplication, no retries, no token-refresh queue (a 401 logs the user out), a single timeout for everything, raw server messages shown to users.
3. **No observability.** No request latency, query counts or slow-request log, so slow endpoints cannot be identified from data.
4. **The mobile app is organised by screen type, not by feature/layer.** Screens call `endpoints.*` directly; there are no ViewModels, use cases or repository boundaries. The largest file is 934 lines.

## 2. Current architecture

**Mobile** (Expo SDK 56, React Native 0.85, TypeScript, Hermes): 55 source files.
`src/screens/{auth,customer,admin,partner}` hold screens that fetch data through a `useLoad(fn, events)` hook and call `endpoints.*` (`src/api/endpoints.ts`) → `api()` (`src/api/client.ts`) → `fetch`. State: Zustand for session, cart (persisted subset), dialogs. Navigation: React Navigation, one stack per role chosen from the server-assigned role. Realtime: socket.io client with a handler registry. Auth: Firebase phone OTP (native module) with the ID token read per request; dev provider (`SecureStore`) only when `AUTH_MODE=dev`.

**Backend** (Node 20+, Express 5, TypeScript via tsx, `pg`): routers `general`, `orders`, `staff` (admin + partner), `chat`, `extras`. Zod validation, `authed` + `requireRole` middleware, services for Cloudinary/Razorpay/FCM, socket.io rooms per user. Database: Supabase Postgres with RLS and a restricted `kmh_api` role. Hosting: Render free web service (Singapore). Files: Cloudinary (signed, authenticated delivery).

## 3. Target architecture

Clean Architecture + MVVM, feature-first:

```
mobile/src/
  app/            providers, navigation, bootstrap
  core/           network (httpClient, retry, dedupe, refresh queue), logging, errors, config, storage
  shared/         ui atoms/molecules, hooks, theme, utils
  features/<feature>/
    presentation/ screens, components, viewmodels   (View -> ViewModel)
    domain/       entities, usecases, repository interfaces
    data/         dto (zod), mappers, datasources, repository implementations
```

Dependency rule: presentation → domain ← data; infrastructure (network, storage) only reached from `data`. A View never imports `fetch`/`endpoints`.

## 4. Folder structure

As above. Existing `screens/`, `components/`, `api/` migrate feature by feature (orders, notifications, chat, reviews, auth, admin dashboard, partner duty). Pure TypeScript layers (core, domain, data, viewmodel logic) are testable with a plain Node test runner; only the thin View needs React Native.

## 5. API performance findings (measured)

| Measurement (production, 7 Oct) | Result |
|---|---|
| First request after idle (`/health`) | **53.0 s** time-to-first-byte (instance cold start) |
| Warm `/health` | DNS 15 ms, connect 60–75 ms, TLS ≈190 ms, TTFB 330 ms |
| Warm `/config` (1 DB query) | TTFB 380–630 ms |
| Warm `/pincodes` | TTFB 430 ms |
| Response compression | none (`content-encoding` absent) |
| Response caching | none (`etag` present, no `cache-control`) |

Findings:

- **P1 (critical)** Render free tier sleeps after ~15 min idle; the first user waits up to ~50 s. Fix: paid always-on instance. A keep-alive ping is *not* recommended: free instances share 750 h/month per workspace and this workspace runs six services, so pinging one would starve the others.
- **P2 (high)** API and DB in different regions. Render has no Mumbai region; Supabase is in Mumbai. Mitigation: fewer sequential queries per request (batch/parallelise), an in-process cache for the per-request user lookup, and later a same-region pair (e.g. Supabase in Singapore) when data can be migrated.
- **P3 (high)** Every authenticated request runs a `users` lookup before the handler: one extra cross-region round trip (~60–70 ms) on every call.
- **P4 (medium)** `loadOrder` ran five queries, some sequentially after the first parallel batch.
- **P5 (medium)** No gzip, no `Cache-Control`; list endpoints return full objects.
- **P6 (medium, client)** No de-duplication: screen focus, realtime refresh and pull-to-refresh can fire identical GETs. `useLoad` coalesces realtime bursts (250 ms) but not focus + effect + manual reload.
- **P7 (medium, client)** No retry for transient failures; single 20 s timeout for everything; no stale-while-revalidate.
- **P8 (low)** Images use signed Cloudinary originals; previews use width-limited JPEG conversion already (1200 px).

## 6. Security findings

**Strong already:** server-side roles and resource ownership (`loadOrder`, chat, reviews); prices only from the admin; Razorpay HMAC + webhook raw-body verification; idempotency keys on order creation; signed uploads with per-user folders; blocked executable extensions; no secrets in the app bundle (`EXPO_PUBLIC_*` hold only the API URL and optional Sentry DSN; `google-services.json` is public client config); dev login refused when `NODE_ENV=production`; generic 500 messages; short-lived invoice/export links with purpose-bound signed tokens.

| # | Severity | Finding |
|---|---|---|
| S1 | High | Rate limiting only on `/auth`; no limit on uploads signing, chat, reviews, broadcast or general API use |
| S2 | High | CORS and socket.io allow every origin (`*`). Tokens are in headers, not cookies, so CSRF risk is low, but the allowlist should be explicit |
| S3 | High | 401 handling logs the user out instead of refreshing the token once; a clock-skewed or just-expired token forces re-login |
| S4 | Medium | Postgres TLS uses `rejectUnauthorized: false` (encrypted but not verified; MITM possible on the DB hop) |
| S5 | Medium | Raw server `message` text is shown to users for 5xx |
| S6 | Medium | Android `allowBackup` not disabled (app data can be pulled via adb backup); cleartext traffic not explicitly forbidden |
| S7 | Medium | Android release build has R8/ProGuard off (default). JS is Hermes bytecode; native code unshrunk |
| S8 | Medium | WebView (live map) loads `originWhitelist: ['*']` and Leaflet from unpkg without Subresource Integrity |
| S9 | Medium | No audit log for sensitive admin actions (quote, cancel, assign, broadcast, exports) |
| S10 | Medium | No request id: errors cannot be correlated between app, server logs and Sentry |
| S11 | Low | Production client falls back to `http://localhost:4000` if `EXPO_PUBLIC_API_URL` is missing (fails closed, but should refuse non-HTTPS outright) |
| S12 | Low | Web admin keeps the dev token in `localStorage` when `AUTH_MODE=dev` (dev only; production web uses Firebase persistence) |
| S13 | Low | Dependency audit: backend 2 moderate (`uuid` via `gaxios`, transitive from firebase-admin); mobile 1 high (`@grpc/grpc-js` via the Firebase JS SDK's Firestore, which this app does not use). Accepted: not reachable; the "fix" is a breaking firebase downgrade |
| S14 | Info | Cloudinary signed uploads do not cap file size at the signature level (server validates declared size; Cloudinary account limit is 10 MB) |

Not applicable / by design: payment amounts, order status, role and ownership are never taken from the client.

## 7. Reverse-engineering risk assessment

Assume the APK is fully inspectable. What an attacker gets: the JS bundle (Hermes bytecode, minified; easily decompiled to readable logic), API base URL, route names, Firebase *client* config (public by design), Sentry DSN (public by design), UI strings.

What they do **not** get: any server secret, any price/role/status authority, any other customer's data (blocked by server-side ownership checks), unsigned upload ability.

Residual risks and proportionate mitigations:

- *Modified/repackaged app or scripted API abuse* → server rate limits, per-user limits, idempotency, validation (done in this pass); Play Integrity attestation is recommended **before a public Play Store launch** (needs Google Cloud setup and a server-side verdict check; cannot be completed from the client alone).
- *Rooted device / debugger / emulator detection* → adds friction only; deliberately **not** implemented now because false positives lock out legitimate customers on old/rooted phones and the backend is already the trust boundary.
- *Certificate pinning* → evaluated, **not recommended yet**: Render/Cloudflare rotate certificates automatically, so a pin without an operational rotation plan can brick the app. If required later: pin the intermediate CA public key (SPKI), ship two backup pins, keep a remote kill-switch, and test with proxies disabled.
- *R8 / obfuscation* → planned as its own verified build (Section 13); not enabled blindly because a missing keep rule crashes release builds (Razorpay, Firebase, Sentry reflection).

## 8. MVVM migration strategy

1. Build the shared core first (network client, logger, errors), because every feature needs it.
2. Migrate one small vertical slice completely as the reference: **Notifications** (View → ViewModel → UseCases → Repository interface → Repository impl → DataSource → DTO + zod → Mapper → Entity).
3. Migrate by feature, highest churn first: Orders (list/detail/track), Chat, Reviews, Auth, Admin dashboard, Partner duty, Checkout.
4. For each feature: extract ViewModel hook (state + intents, no JSX), move API calls into a repository, add tests, then slim the View. Delete the old direct `endpoints.*` call only when no screen imports it.
5. Keep `endpoints.ts` as the data-source implementation until all features are migrated, so the API contract never changes mid-migration.

## 9. UI component strategy

Atoms (`Button`, `Text`, `Icon`, `Pill`, `Avatar`, `TextField`), molecules (`Card`, `ListItem`, `Section`, `QuickAction`, `ReviewCard`, `StarRating`), organisms (`OrderCard`, `PaymentSheet`, `FileViewer`, `DialogHost`, `LiveMap`), screens. Rules already adopted: one fixed button height; one dialog/popup mechanism; one file viewer. To do: split `AdminScreens.tsx` (934 lines) and `OrderScreens.tsx` (467) into per-screen files under `features/`, extract `Section`/`QuickAction`/chat bubbles into `shared/components`.

## 10. State management strategy

Keep Zustand (small, already adequate). Separate: **server state** (currently `useLoad`; keep, add de-dup and stale-while-revalidate in the network layer rather than adding TanStack Query now), **UI state** (component state), **auth state** (session store + secure token provider), **form state** (local state; zod validation at the domain boundary), **persistent state** (only language and the non-sensitive cart draft; nothing sensitive in AsyncStorage). Introduce TanStack Query only if the migration shows `useLoad` can no longer cover pagination/optimistic updates.

## 11. Testing strategy

- Unit (Node test runner, no device): network client (dedupe, retry, refresh queue, timeouts), logger redaction, mappers/DTO validation, use cases, repositories with a fake data source, ViewModel logic.
- Backend integration (already 21 tests against a real database): lifecycle, attendance, chat queue, reviews, exports, bills, notifications. Added: headers, CORS, rate limits, caching, request id.
- Security tests: authorisation (role/ownership 403/404), tampered export/invoice tokens, token-bound links, validation failures, idempotent replay.
- Component tests (React Native Testing Library) for forms, buttons, states: planned with the first screen migrations.
- E2E (Maestro or Detox): login, place order, cancel, chat, review: planned; needs a staging backend with `AUTH_MODE=dev` and seeded data.

## 12. Production hardening checklist

- [ ] Always-on API instance (no cold starts) and, if possible, API + DB in one region.
- [x] HTTPS only (HSTS present); client refuses non-HTTPS API URL in production.
- [x] Per-route and global rate limits.
- [x] CORS allowlist.
- [x] gzip, cache policy, `Cache-Control: no-store` on authenticated responses.
- [x] Request id, Server-Timing, structured latency logs, slow-request warnings.
- [x] 401 → single-flight refresh → one retry.
- [x] Android: `allowBackup=false`, cleartext off.
- [ ] Android: R8 + shrinkResources (dedicated verified build).
- [ ] Postgres CA verification (needs the Supabase CA certificate, `DATABASE_CA`).
- [ ] Play Integrity verification before public launch.
- [ ] Audit log table for admin actions.
- [ ] Staging environment (separate Render service + Supabase branch) and an EAS `staging` profile.
- [ ] Sentry DSN + source-map upload (auth token) so crashes are readable.

## 13. Prioritised implementation plan

1. **P0:** move off the free instance (decision for the owner; no code).
2. **Phase 3 (done in this pass):** backend performance + observability; mobile network client.
3. **Phase 4 (done):** token refresh queue, safe errors, CORS/rate limits, Android flags, logging redaction, WebView hardening.
4. **Phase 5–6 (started):** `core/` plus the Notifications reference slice with tests.
5. **Next:** migrate Orders, Chat, Reviews, Auth, Admin dashboard (one release each), splitting the large files as they move.
6. **Then:** R8 build and verification, Postgres CA, audit log, staging, Play Integrity, E2E suite.

## 14. Implementation status

See the bottom of this file after the work in this pass (appended below).

### 14.1 Done in this pass (all verified by automated tests: backend 28, mobile 28, both type-check)

**Backend (Phase 3 / 4 / 10)**
- Request id on every response and error body, `Server-Timing` (database time and query count), rolling p50/p95/p99 per route (`GET /admin/metrics`), structured request log lines (route pattern only; no query strings, headers, bodies or personal data), slow-request warnings and Sentry report above 5 s.
- gzip; `Cache-Control` (`public, max-age=15, stale-while-revalidate=60` for `/config`, `/pincodes`, `/terms`; `no-store` for everything else); working ETag/304.
- CORS allowlist (`CORS_ORIGINS`), same for sockets; global rate limit (300 req/min per user or IP) plus 30/min on uploads signing, chat, reviews, order creation, broadcasts and export links.
- Per-request user lookup cached for 15 s and invalidated on profile, avatar and delete writes (one fewer cross-region round trip per call). `loadOrder` now runs all its queries in one parallel batch.
- Database pool tuned (10 connections kept warm for 5 min, 8 s connect timeout, 15 s statement timeout, keep-alive); optional verified TLS through `DATABASE_CA`.
- Validation errors no longer echo internals; every error carries a request id for support.
- Measured locally against the production database: `GET /orders/:id` runs 6 queries in one parallel batch in 160–190 ms warm (the first call after startup pays ~0.5 s for opening database connections).

**Mobile (Phase 3 / 4 / 5 / 6)**
- `core/network/httpClient.ts`: de-duplicated GETs, per-call cancellation, timeout policies, safe retries with exponential backoff and jitter (GET only; writes only when marked idempotent, e.g. order creation with its idempotency key; never payments), single-flight token refresh with one retry on 401, safe error messages (5xx details never shown), optional response validation (zod), "server waking up" signal shown on the splash. `api/client.ts` is now a thin wrapper, so no call site changed.
- `core/logging`: environment-aware logger with redaction of tokens, OTPs, phone, email, address, auth headers; errors forwarded to Sentry.
- Production build refuses a non-HTTPS API URL.
- Android: `allowBackup=false`, cleartext traffic disabled. WebView: restricted origins/navigation, no file access, Subresource Integrity on the Leaflet assets.
- Memory: fixed a location-watch subscription that could outlive its screen; fixed an uncleaned timer; `useLoad` no longer sets state after unmount.
- **Reference MVVM slice: Notifications** (`src/features/notifications`): entity, repository interface, use cases, DTO + zod, mapper, remote data source, repository implementation, framework-free view model, React hook, View. 12 unit tests; they caught a real optimistic-update bug (mark-all and clear-all skipped their request) before it shipped.
- Test runner for pure TypeScript (`npm test`), separate test tsconfig (`npm run typecheck`).

### 14.2 Not done yet (and why)
- **Migrating the remaining features to MVVM** (orders, checkout, chat, reviews, auth, admin dashboard, partner). This is deliberately incremental: each is a release of its own, tested before the next. Estimated 1–2 days per feature. The core and the reference slice are in place so each migration is mechanical.
- **Splitting `AdminScreens.tsx` (934 lines) and `OrderScreens.tsx`**: done as each feature migrates.
- **Always-on hosting and same-region database**: owner decision (cost). This is the largest single latency win available (53 s → 0.3 s for the first request).
- **R8/ProGuard**: needs a dedicated build and a device test; a wrong keep rule crashes release builds.
- **Postgres CA verification**: needs the Supabase CA certificate (set `DATABASE_CA`).
- **Play Integrity, certificate pinning, root/emulator detection**: assessed in section 7; deferred for the reasons given there.
- **Audit log table, staging environment, E2E suite, component tests**: planned in sections 11–13.
