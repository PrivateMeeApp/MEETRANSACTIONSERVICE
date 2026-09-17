# MEE Transaction Service API Reference

This document describes every HTTP API registered by the Transaction Service, its authentication behavior, the Razorpay integration, and the database-backed request/response behavior.

## Base URL and conventions

- Local base URL: `http://localhost:3001`
- The port is controlled by `PORT` and defaults to `3001`.
- All request bodies are JSON when a body is required.
- CORS is enabled for all origins.
- The public route prefix for wallet APIs is `/wallet`.
- There is no `/api` prefix.

## Authentication

The root status endpoint is public. All `/wallet/*` endpoints use the `authMiddleware` and require:

```http
Authorization: Bearer <jwt>
```

The middleware decodes the JWT payload with `jsonwebtoken.decode()` and does not verify its signature. The decoded payload must contain a truthy `uid`; the middleware then sets:

```js
req.user = {
  uid: decoded.uid,
  role: decoded.role
}
```

Missing or malformed authorization header:

```json
{
  "error": "Unauthorized: No token provided"
}
```

Missing `uid` or an invalid decoded token:

```json
{
  "error": "Unauthorized: Invalid token"
}
```

Because the signature is not verified by this service, token verification must be performed by an upstream gateway or the middleware must be strengthened before relying on this service as a security boundary.

## Common error response

Most controller failures return one of these shapes:

```json
{
  "error": "Invalid amount"
}
```

or:

```json
{
  "error": "Internal Server Error"
}
```

Typical status codes are `400` for validation errors, `401` for missing/invalid decoded authentication, `404` for missing payment records, and `500` for database/provider failures.

---

## Service status API

### `GET /`

Public endpoint.

**req**

No headers, query parameters, or body are required.

**res** `200`

Plain text, not JSON:

```text
Transaction Service is running
```

---

## Wallet and payment APIs

All endpoints below require the `Authorization: Bearer <jwt>` header. The user ID is taken from the decoded token and cannot be supplied as a route parameter for these APIs.

### `GET /wallet/balance` - Get wallet balance

**req**

No body or query parameters are required.

**res** `200`

```json
{
  "balance": "250.00"
}
```

If the user does not have a wallet, the service creates one with a zero balance before responding:

```json
{
  "balance": "0.00"
}
```

The exact decimal serialization depends on Sequelize/PostgreSQL decimal handling.

### `POST /wallet/add-money` - Create wallet top-up order

This endpoint creates a Razorpay order and local pending transaction. It does not credit the wallet until payment verification succeeds.

**req**

```json
{
  "amount": 500
}
```

`amount` is required and must be greater than zero. The service converts the amount to the smallest currency unit for Razorpay by calculating `Math.round(amount * 100)`. Currency is always `INR`.

**res** `200`

```json
{
  "order": {
    "id": "order_ABC123",
    "entity": "order",
    "amount": 50000,
    "amount_paid": 0,
    "amount_due": 50000,
    "currency": "INR",
    "receipt": "receipt_1760000000000",
    "status": "created"
  },
  "transaction_id": 101,
  "key": "<RAZORPAY_KEY_ID>"
}
```

The exact `order` fields are returned by Razorpay's Orders API/SDK. Locally, the service also creates:

- A `CREDIT` transaction with `PENDING` status and description `Add money to wallet`.
- A `Payment` row with status `CREATED` and the Razorpay order ID.

Invalid or missing amount:

```json
{
  "error": "Invalid amount"
}
```

Status: `400`.

### `POST /wallet/verify-payment` - Verify Razorpay payment

This endpoint verifies a wallet top-up or session payment using the Razorpay signature. It is also reused by `/wallet/verify-session-payment`.

**req**

```json
{
  "razorpay_order_id": "order_ABC123",
  "razorpay_payment_id": "pay_XYZ789",
  "razorpay_signature": "generated-signature",
  "transaction_id": 101
}
```

The service computes:

```text
HMAC-SHA256(
  razorpay_order_id + "|" + razorpay_payment_id,
  RAZORPAY_KEY_SECRET
)
```

The computed hexadecimal digest must equal `razorpay_signature`.

**res** `200`

```json
{
  "success": true,
  "balance": 750
}
```

On success, the service:

1. Marks the payment `CAPTURED`.
2. Stores the Razorpay payment ID and signature.
3. Marks the transaction `SUCCESS`.
4. Credits the wallet for a `CREDIT` transaction.
5. Deducts any wallet-funded portion for a `DEBIT` transaction.

Invalid signature:

```json
{
  "error": "Payment verification failed"
}
```

Status: `400`. The related transaction and payment are marked `FAILED` when the update finds matching records.

Payment record not found:

```json
{
  "error": "Payment not found"
}
```

Status: `404`.

### `POST /wallet/verify-session-payment` - Verify session payment

This route calls the exact same `verifyPayment` controller as `/wallet/verify-payment`.

**req**

```json
{
  "razorpay_order_id": "order_ABC123",
  "razorpay_payment_id": "pay_XYZ789",
  "razorpay_signature": "generated-signature",
  "transaction_id": 202
}
```

**res** `200`

```json
{
  "success": true,
  "balance": 250
}
```

Validation, signature failure, missing payment, and internal errors use the same responses as `/wallet/verify-payment`.

### `GET /wallet/transactions` - Get successful wallet transactions

**req**

No body or query parameters are required.

**res** `200`

If the authenticated user has no wallet:

```json
[]
```

If a wallet exists, only transactions with status `SUCCESS` are returned, ordered by `created_at` descending:

```json
[
  {
    "id": 101,
    "user_id": 7,
    "expert_id": null,
    "session_id": null,
    "wallet_id": 12,
    "type": "CREDIT",
    "amount": "500.00",
    "status": "SUCCESS",
    "description": "Add money to wallet",
    "is_wallet_txn": true,
    "created_at": "2026-09-12T10:00:00.000Z"
  },
  {
    "id": 102,
    "user_id": 7,
    "expert_id": null,
    "session_id": "session-uuid",
    "wallet_id": 12,
    "type": "DEBIT",
    "amount": "199.00",
    "status": "SUCCESS",
    "description": "Paid for chat session (via Wallet)",
    "is_wallet_txn": true,
    "created_at": "2026-09-12T11:00:00.000Z"
  }
]
```

The exact serialized fields are the Sequelize `Transaction` model fields.

### `GET /wallet/calculate-bill` - Calculate session bill

**req**

Optional query parameter:

```http
GET /wallet/calculate-bill?mode=voice
```

Supported `mode` values and base prices:

| `mode` | Base price |
| --- | ---: |
| omitted or any other value | `199` |
| `voice` | `220` |
| `video` | `250` |

The current discount service is a local placeholder that always returns `0`; no discount microservice is called.

**res** `200`

For `mode=chat` or an omitted/unknown mode:

```json
{
  "basePrice": 199,
  "discount": 0,
  "totalToPay": 199
}
```

For `mode=voice`:

```json
{
  "basePrice": 220,
  "discount": 0,
  "totalToPay": 220
}
```

For `mode=video`:

```json
{
  "basePrice": 250,
  "discount": 0,
  "totalToPay": 250
}
```

### `POST /wallet/pay-session` - Start or complete session payment

**req**

```json
{
  "mode": "voice",
  "useWallet": true
}
```

- `mode` selects the base price: `199` by default, `220` for `voice`, and `250` for `video`.
- `useWallet` controls whether the current wallet balance is applied. Only a truthy value applies wallet funds.
- Discounts are currently always zero.

**res** `200` when a Razorpay payment is still required

```json
{
  "order": {
    "id": "order_SESSION123",
    "entity": "order",
    "amount": 12000,
    "amount_paid": 0,
    "amount_due": 12000,
    "currency": "INR",
    "receipt": "session_1760000000000",
    "status": "created"
  },
  "transaction_id": 202,
  "key": "<RAZORPAY_KEY_ID>"
}
```

The Razorpay amount is the remaining amount after wallet deduction, in paise. The local transaction amount is the full session total, with `DEBIT` and `PENDING` status. The payment row stores the remaining Razorpay amount.

**res** `200` when the wallet fully covers the session

```json
{
  "success": true,
  "transaction_id": 203
}
```

The wallet is debited immediately, and a `DEBIT` transaction with `SUCCESS` status and `is_wallet_txn: true` is created.

### `POST /wallet/link-session` - Link a transaction to a session

**req**

```json
{
  "transaction_id": 202,
  "session_id": "session-uuid"
}
```

Both fields are required. `transaction_id` identifies the local transaction and `session_id` is stored in its `session_id` column.

**res** `200`

```json
{
  "success": true
}
```

Missing values:

```json
{
  "error": "Missing parameters"
}
```

Status: `400`.

---

## Razorpay external API integration

The service uses the Razorpay Node SDK configured with `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.

### Razorpay Orders API: `POST https://api.razorpay.com/v1/orders`

The application reaches this external API through `razorpay.orders.create(options)` in the SDK. It is called by:

- `POST /wallet/add-money`
- `POST /wallet/pay-session` when the wallet does not fully cover the bill

**req** sent through the SDK

```json
{
  "amount": 50000,
  "currency": "INR",
  "receipt": "receipt_1760000000000"
}
```

For session payment, the receipt is prefixed with `session_` and the amount is the remaining amount after wallet deduction. The amount is always an integer in paise.

The SDK authenticates the request using the Razorpay key ID and secret configured in environment variables. Credentials are not returned in this document.

**res**

Razorpay returns an order object similar to:

```json
{
  "id": "order_ABC123",
  "entity": "order",
  "amount": 50000,
  "amount_paid": 0,
  "amount_due": 50000,
  "currency": "INR",
  "receipt": "receipt_1760000000000",
  "status": "created",
  "attempts": 0,
  "notes": []
}
```

The service stores `order.id` in the local `payments.razorpay_order_id` column and returns the complete SDK order object to the client. Provider failures are caught by the controller and returned as:

```json
{
  "error": "Internal Server Error"
}
```

Status: `500`.

### Razorpay payment verification

There is no separate server-side Razorpay payment-fetch or webhook endpoint in this project. The client sends the Razorpay IDs and signature to the local verification route. The service verifies the signature locally using HMAC-SHA256 and `RAZORPAY_KEY_SECRET`.

### Razorpay webhook API

No webhook route is registered. The service does not receive Razorpay webhooks.

---

## Database integration

The service uses Sequelize with PostgreSQL through `DATABASE_URL`. SSL is enabled with `rejectUnauthorized: false`. Startup authenticates the connection and runs `sequelize.sync({ alter: true })`.

The main persisted records are:

### Wallet

```json
{
  "id": 12,
  "uid": 7,
  "balance": "500.00",
  "created_at": "2026-09-12T10:00:00.000Z"
}
```

### Transaction

Fields include `id`, `user_id`, `expert_id`, `session_id`, `wallet_id`, `type`, `amount`, `status`, `description`, `is_wallet_txn`, and `created_at`.

`type` values are `CREDIT`, `DEBIT`, and `REFUND`. `status` values are `PENDING`, `SUCCESS`, `FAILED`, and `REFUNDED`.

### Payment

Fields include `id`, `transaction_id`, `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`, `amount`, `status`, `method`, `created_at`, and `updated_at`.

Payment `status` values are `CREATED`, `AUTHORIZED`, `CAPTURED`, `FAILED`, and `REFUNDED`.

No database REST API is exposed; PostgreSQL is accessed internally through Sequelize.

---

## Discount integration status

`services/discountService.js` exposes `getDiscount(productId, userId)`, but it is currently a local stub:

```js
return 0;
```

It does not call a third-party API or another microservice. Therefore every bill currently has a zero discount.

---

## Environment-controlled integrations

The service reads these environment variables:

```text
DATABASE_URL=<PostgreSQL connection string>
RAZORPAY_KEY_ID=<Razorpay key ID>
RAZORPAY_KEY_SECRET=<Razorpay key secret>
PORT=3001
```

The repository's `.env` contains credentials, but they are intentionally not reproduced in this documentation.

## API inventory

Registered routes covered by this document:

1. `GET /`
2. `GET /wallet/balance`
3. `POST /wallet/add-money`
4. `POST /wallet/verify-payment`
5. `GET /wallet/transactions`
6. `GET /wallet/calculate-bill`
7. `POST /wallet/pay-session`
8. `POST /wallet/verify-session-payment`
9. `POST /wallet/link-session`
