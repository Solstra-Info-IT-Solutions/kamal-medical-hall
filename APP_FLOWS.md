# Kamal Medical Hall app flows

This document translates the supplied PRD flowcharts and the client’s later decisions into role-specific app journeys. The PRD is product reference material; confirmed client decisions take precedence where they differ. The PRD proposes a web admin panel, while the client requests admin and partner experiences to open from the app after role-aware OTP login. Customer ordering is available on Android and iOS. These flows are API-backed in production; local mock data is for UI development only.

## Shared sign-in and role routing

```mermaid
flowchart TD
  A[Open app] --> B[Enter mobile number]
  B --> C[Verify OTP]
  C --> D{Server returns account role}
  D -->|Customer| E[Customer home]
  D -->|Store admin| F[Admin dashboard]
  D -->|Delivery partner| G[Partner availability and jobs]
  C -->|Invalid OTP| B
```

The verified phone number is an account identifier, not an authorization rule. The backend assigns each account exactly one role and returns that role after OTP verification. The app routes from the authenticated role claim. A development-only role preview may help review the three experiences; it must never be present in production or replace server authorization.

## Customer journey

```mermaid
flowchart TD
  A[OTP login] --> B{First login?}
  B -->|Yes| C[Enter full name; email optional]
  B -->|No| D[Home]
  C --> D
  D --> E{Choose one order type}
  E -->|Prescription| F[Take photo, choose gallery files, or PDF; max 3 files]
  E -->|Catalogue| G[Search medicines and set quantities]
  F --> H[Add optional note]
  G --> H
  H --> I[Choose or add saved address]
  I --> J[Validate Jaipur service pincode]
  J -->|Unsupported| I
  J -->|Supported| K[Choose delivery date and two-hour slot]
  K --> L[Submit request; free delivery]
  L --> M[Wait for pharmacy stock and prescription review]
  M -->|Rejected / unavailable| N[See reason and notification]
  M -->|Quote ready| O[Review item details and final amount]
  O -->|Decline / cancel with reason| P[Submit cancellation reason]
  O -->|Accept| Q{Choose payment}
  Q -->|Razorpay| R[Complete Razorpay checkout]
  Q -->|COD| S[Confirm cash on delivery]
  R --> T[Order confirmed]
  S --> T
  T --> U[Track status and assigned delivery]
  U --> V[Delivered; appears in completed orders]
```

Prescription files and catalogue medicines cannot be combined. The cart asks before discarding the current order if the customer switches type. A customer can cancel in order details with a required reason, but only before the order goes out for delivery. The store has no refund policy; the app must not promise a refund. The completed-orders list contains completed orders; active tracking is reached from order notifications/details.

## Store admin journey

```mermaid
flowchart TD
  A[Admin OTP login] --> B[Dashboard: request/payment/delivery counts]
  B --> C[New requests]
  C --> D[Open order detail]
  D --> E{Prescription order?}
  E -->|Yes| F[Review files; record reviewer]
  E -->|No| G[Check requested catalogue items]
  F --> H{Can fulfill?}
  G --> H
  H -->|No| I[Reject with reason; notify customer]
  H -->|Yes| J[Enter final amount and send quote]
  J --> K{Customer accepts quote?}
  K -->|No / cancellation request| L[Cancel before dispatch with customer reason]
  K -->|Razorpay| M[Verify gateway result]
  K -->|COD| N[Accept as COD]
  M --> O[Ready to dispatch]
  N --> O
  O --> P[Choose available store staff member]
  P --> Q[Partner receives assignment]
  Q --> R[Track out-for-delivery and delivered updates]
  B --> S[All orders / search / history]
  B --> T[Payments / customers / staff / reports / settings]
```

Admin screens: dashboard, new requests, order review, quote/rejection, payment status, assign partner, all orders, partner availability, customer list, reports, and store settings. Staff roster is limited to the store’s two or three delivery staff. Store settings include operating status and timings when supplied. Prescription approval should record the responsible pharmacist/admin identity, as required by the PRD.

## Delivery partner journey

```mermaid
flowchart TD
  A[Partner OTP login] --> B[Availability screen]
  B -->|Set available| C[Wait for store assignment]
  C --> D[Open assigned order]
  D --> E[Review customer, address, phone, order, and payment type]
  E --> F[Call customer or open map directions]
  F --> G[Mark out for delivery]
  G --> H[Arrive and hand over order]
  H --> I{COD?}
  I -->|Yes| J[Record cash collected]
  I -->|No| K[No cash collection]
  J --> L[Mark delivered]
  K --> L
  L --> M[Return to available]
  B -->|Set busy| N[Stop receiving assignments]
```

Partner screens: login, availability, assignment notification, assigned-order detail, call/map actions, delivery status update, and COD cash summary. Live location tracking is Phase 2 in the PRD and is not part of this MVP flow.

## Order status model from the PRD

`Requested → Quoted → Accepted → Awaiting payment (Razorpay) / COD accepted → Ready to dispatch → Out for delivery → Delivered`

Terminal alternatives: `Rejected` (store reason required) and `Cancelled` (customer reason required or store-initiated reason). Customer cancellation is allowed only before out-for-delivery. No refund policy is provided, so no refund should be promised in customer-facing copy; payment-cancellation behavior requires backend/business handling before production.
