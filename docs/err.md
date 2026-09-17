# MEE Transaction Service Error Reference

This document lists the HTTP error statuses and failure behavior implemented by the Transaction Service.

## General response format

Successful wallet routes are protected by `middlewares/auth.js` and require:

```http
Authorization: Bearer <jwt>
```

The service uses simple JSON error bodies rather than a centralized error envelope:

```json
{
  "error": "Internal Server Error"
}
```

There is no global Express error middleware. Controllers catch errors themselves and convert most unexpected failures to HTTP `500`.

---

## err code - 400

**explanation -** The request is syntactically accepted but fails a local validation rule. The caller must correct the amount, payment verification data, or linking fields before retrying.

**usecases in prod -**

- `POST /wallet/add-money` receives a missing, zero, negative, or otherwise falsy `amount`.
- Razorpay payment signature does not match the locally generated HMAC signature.
- `POST /wallet/link-session` is missing `transaction_id`.
- `POST /wallet/link-session` is missing `session_id`.
- Any client sends an invalid payment verification payload that reaches signature failure handling.

**responses -**

Invalid top-up amount:

```json
{
  "error": "Invalid amount"
}
```

Payment signature failure:

```json
{
  "error": "Payment verification failed"
}
```

Missing session-link fields:

```json
{
  "error": "Missing parameters"
}
```

The frontend separately validates some values, such as wallet top-up range and Razorpay amount, but backend validation remains authoritative.

---

## err code - 401

**explanation -** The transaction request does not contain a usable Bearer token or the decoded token does not contain a valid user ID. The middleware rejects the request before wallet business logic runs.

**usecases in prod -**

- Missing `Authorization` header on any `/wallet/*` route.
- Authorization header does not start with `Bearer `.
- JWT payload cannot be decoded.
- Decoded token is missing a truthy `uid`.
- Malformed token causes the middleware's decode operation to fail.

**responses -**

No token:

```json
{
  "error": "Unauthorized: No token provided"
}
```

Invalid token:

```json
{
  "error": "Unauthorized: Invalid token"
}
```

**security note -** The current middleware uses `jwt.decode()` and does not verify the JWT signature. This means the status indicates missing/undecodable token data, not cryptographic authentication failure.

---

## err code - 404

**explanation -** A required local payment record cannot be found for the supplied transaction. The request reached payment verification, but there is no matching `payments` row to update.

**usecases in prod -**

- `POST /wallet/verify-payment` uses a transaction ID with no payment row.
- `POST /wallet/verify-session-payment` uses a transaction ID with no payment row.
- The local transaction/payment creation sequence was interrupted or received an unknown ID.
- The client retries verification with a stale or incorrect transaction ID.

**response -**

```json
{
  "error": "Payment not found"
}
```

A missing wallet in `GET /wallet/transactions` does not return `404`; it returns an empty array.

---

## err code - 500

**explanation -** An unexpected database, Razorpay SDK, configuration, or runtime failure prevented the transaction operation from completing. The client should retry cautiously and use server logs/provider dashboards for diagnosis.

**usecases in prod -**

- PostgreSQL authentication, connection, query, or write failure.
- Wallet creation or balance lookup failure.
- Transaction or payment row creation failure.
- Razorpay order creation failure in `/wallet/add-money`.
- Razorpay order creation failure in `/wallet/pay-session`.
- Missing/invalid Razorpay configuration causing the SDK call or HMAC operation to fail.
- Payment lookup, transaction lookup, wallet lookup, or balance update failure during verification.
- Failure while linking a transaction to a session.
- Failure while loading successful transaction history.
- Failure while calculating a bill or invoking the discount service.
- Startup database authentication or `sequelize.sync({ alter: true })` failure.

**standard response -**

```json
{
  "error": "Internal Server Error"
}
```

The service logs the detailed underlying error server-side and intentionally returns the generic message to the client.

---

# Payment-specific failure behavior

## Invalid Razorpay signature

The backend computes:

```text
HMAC-SHA256(
  razorpay_order_id + "|" + razorpay_payment_id,
  RAZORPAY_KEY_SECRET
)
```

When it does not equal `razorpay_signature`:

- The transaction is updated to `FAILED`.
- The payment is updated to `FAILED`.
- The supplied Razorpay payment ID and signature are stored on the payment row.
- HTTP `400` is returned.

```json
{
  "error": "Payment verification failed"
}
```

## Missing payment row

Signature verification can pass before the local payment row is found. In that case:

- No payment capture update occurs.
- HTTP `404` is returned.
- The response is `{ "error": "Payment not found" }`.

## Razorpay provider failure

If `razorpay.orders.create()` throws:

- The controller catches the provider error.
- The detailed provider error is logged server-side.
- HTTP `500` is returned.

```json
{
  "error": "Internal Server Error"
}
```

The service has no Razorpay webhook route and does not independently reconcile asynchronous provider state.

---

# Error behavior by endpoint

| Endpoint | Explicit error statuses | Main causes |
| --- | --- | --- |
| `GET /wallet/balance` | `401`, `500` | Auth failure, wallet lookup/create failure. |
| `POST /wallet/add-money` | `400`, `401`, `500` | Invalid amount, auth failure, Razorpay/database failure. |
| `POST /wallet/verify-payment` | `400`, `401`, `404`, `500` | Invalid signature, auth failure, missing payment, database/config failure. |
| `GET /wallet/transactions` | `401`, `500` | Auth failure, wallet/history query failure. |
| `GET /wallet/calculate-bill` | `401`, `500` | Auth failure, bill/discount calculation failure. |
| `POST /wallet/pay-session` | `401`, `500` | Auth failure, Razorpay/database/balance failure. |
| `POST /wallet/verify-session-payment` | `400`, `401`, `404`, `500` | Same controller and behavior as `/wallet/verify-payment`. |
| `POST /wallet/link-session` | `400`, `401`, `500` | Missing IDs, auth failure, transaction update failure. |
| `GET /` | None in normal operation | Returns service status text. |

---

# Production client guidance

- Treat `400` as a correctable request or payment-signature problem; do not retry an unchanged invalid signature.
- Treat `401` as an authentication/session problem; obtain a valid token before retrying.
- Treat `404` during payment verification as a local transaction/payment reconciliation issue, not as proof that Razorpay itself failed.
- Treat `500` as a service, database, configuration, or provider failure and retry with backoff where the operation is safe.
- Do not assume a failed `500` order request did not create partial local state; inspect transaction/payment records before blindly retrying in production.
- Never expose Razorpay secrets or raw provider error details to clients.
- The current transaction service does not define `403`, `409`, `429`, or `502` responses in its controllers.
