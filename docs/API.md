# API Reference

> Every public and internal endpoint, with example requests and the responses they return.

This is the **operational** reference — it shows what you can actually call and what comes back. For the reasoning behind these contracts, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Conventions

- `<gateway>` = your API Gateway URL (production: `https://trendy-gateway-ppa6nvipwa-pd.a.run.app`)
- `<users>`, `<auth>`, `<amazon>`, `<walmart>` = direct service URLs, mostly used for debugging or internal calls
- Shopper and admin routes should normally be called through the gateway with the prefix `/api/v1/user`.
- All `curl` examples include `-c cookies.txt -b cookies.txt` so cookies persist across calls. State-changing requests need an `x-csrf-token` header after the first `/csrf-token` call.

## Table of contents

1. [Bootstrap and health](#1-bootstrap-and-health)
2. [Shopper auth](#2-shopper-auth)
3. [Admin](#3-admin)
4. [Cart](#4-cart)
5. [Checkout intents](#5-checkout-intents)
6. [Price tracking](#6-price-tracking)
7. [AI endpoints](#7-ai-endpoints)
8. [Developer auth (Auth server)](#8-developer-auth-auth-server)
9. [Provider APIs](#9-provider-apis)
10. [Internal service-to-service](#10-internal-service-to-service)
11. [Error response shapes](#11-error-response-shapes)

---

## 1. Bootstrap and health

### `GET <gateway>/health`

Simple liveness check. No auth needed.

```bash
curl https://<gateway>/health
```

```json
{ "status": "ok", "service": "gateway", "uptime": 1234.5 }
```

### `GET <gateway>/api/v1/user/csrf-token`

Bootstraps a CSRF token. The token is set as a `csrfToken` cookie **and** returned in the response body. Cross-domain SPAs need the body value because they can't read the cookie via `document.cookie`.

```bash
curl -c cookies.txt https://<gateway>/api/v1/user/csrf-token
```

```json
{ "success": true, "csrfToken": "a1b2c3...32-hex-chars" }
```

After this call, every state-changing request needs `-H "x-csrf-token: <value>"`.

### `GET <users>/health` / `GET <auth>/health` / `GET <amazon>/health` / `GET <walmart>/health`

Per-service liveness checks. Each one returns the service name, uptime, and (where applicable) the DB connection state.

### `GET <auth>/ready`

Auth readiness — returns 503 if Mongo isn't connected, 200 if it's ready.

---

## 2. Shopper auth

### `POST /api/v1/user/auth/signup` — Start signup

Two-step signup: this step validates the inputs, sends an OTP email, and sets a `pendingSignup` cookie. **No user row is created yet.**

```bash
curl -X POST https://<gateway>/api/v1/user/auth/signup \
  -c cookies.txt -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{"name":"Jane","email":"jane@example.com","password":"S3cure!Pass1"}'
```

**Success (200):**
```json
{ "success": true, "message": "OTP sent. Please verify to complete signup." }
```

**Errors:**
- 400 — Invalid input (missing fields, weak password)
- 409 — Email already registered
- 429 — Rate-limited

### `POST /api/v1/user/auth/signup/verify` — Complete signup

Reads the `pendingSignup` cookie, matches the OTP, creates the user, and issues session cookies.

```bash
curl -X POST https://<gateway>/api/v1/user/auth/signup/verify \
  -c cookies.txt -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{"otp":"1234"}'
```

**Success (201):** sets `userToken` and `userRefreshToken`. Body:
```json
{ "success": true, "message": "Signup complete", "user": { "email": "jane@example.com", "name": "Jane" } }
```

**Errors:**
- 400 — No `pendingSignup` cookie
- 401 — Wrong OTP, or too many attempts (the OTP doc has an `attempts` counter)
- 410 — OTP expired (120s TTL)

### `POST /api/v1/user/auth/login`

```bash
curl -X POST https://<gateway>/api/v1/user/auth/login \
  -c cookies.txt -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{"email":"jane@example.com","password":"S3cure!Pass1"}'
```

**Success (200):** sets `userToken` and `userRefreshToken`.
```json
{ "success": true, "user": { "email": "jane@example.com", "name": "Jane" } }
```

**Errors:**
- 403 — `Invalid credentials` (used for both "no such user" and "wrong password" — anti-enumeration)

### `POST /api/v1/user/auth/refresh`

Rotates session cookies using the refresh token.

```bash
curl -X POST https://<gateway>/api/v1/user/auth/refresh \
  -c cookies.txt -b cookies.txt \
  -H "x-csrf-token: <token>"
```

Issues fresh `userToken` + `userRefreshToken`. Also handles admin tokens if `adminRefreshToken` is present.

### `GET /api/v1/user/auth/me`

Returns the current shopper session.

```bash
curl https://<gateway>/api/v1/user/auth/me -b cookies.txt
```

```json
{ "success": true, "user": { "email": "jane@example.com", "name": "Jane", "role": "Customer" } }
```

**Errors:**
- 401 — No valid `userToken`

### `POST /api/v1/user/auth/logout`

Clears session cookies.

### `POST /api/v1/user/recovery/forgotpassword`

Starts password recovery. **Current behavior is non-opaque** — it returns 404 for unknown emails (see [`SECURITY.md` G1](SECURITY.md#g1--users-password-recovery-enumerates-valid-emails)).

```bash
curl -X POST https://<gateway>/api/v1/user/recovery/forgotpassword \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{"email":"jane@example.com"}'
```

### `POST /api/v1/user/recovery/verifyotp`

Verifies the recovery OTP and sets a `recoveryGrant` cookie.

### `POST /api/v1/user/recovery/resetpassword`

Resets the password using the recovery grant.

---

## 3. Admin

All routes require an admin session (`adminToken` cookie), except `/admin/login` and the first-admin bootstrap of `/admin/register`.

### `POST /api/v1/user/admin/login`

```bash
curl -X POST https://<gateway>/api/v1/user/admin/login \
  -c cookies.txt -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{"adminId":"you@example.com","password":"AdminPass!1"}'
```

**Success (200):** sets `adminToken` and `adminRefreshToken`.

### `POST /api/v1/user/admin/register`

Open for the **first** admin only. After that, it requires an authenticated admin session.

```bash
# First admin (no cookies needed)
curl -X POST https://<gateway>/api/v1/user/admin/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","adminId":"admin@example.com","password":"AdminPass!1"}'
```

```bash
# Subsequent admin (requires admin session + CSRF)
curl -X POST https://<gateway>/api/v1/user/admin/register \
  -b admin-cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{"name":"Admin2","adminId":"admin2@example.com","password":"AdminPass!2"}'
```

### `GET /api/v1/user/admin/me`

Returns the current admin session info.

### `POST /api/v1/user/admin/client/details`

Stores `clientId`, `clientSecret`, and `redirectUri` in `temp_clients` (10-minute TTL), keyed by the admin's email. **This is the first step** of the OAuth-style authorize flow.

```bash
curl -X POST https://<gateway>/api/v1/user/admin/client/details \
  -b admin-cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{
    "apiName": "Amazon_Products",
    "clientId": "auth_id_abc123",
    "clientSecret": "<secret>",
    "redirectUri": "https://<users>/admin/auth/callback"
  }'
```

### `POST /api/v1/user/admin/auth`

Triggers the server-side authorize call to Auth. It consumes the `temp_clients` row and POSTs to Auth's `/auth/authorize`.

```bash
curl -X POST https://<gateway>/api/v1/user/admin/auth \
  -b admin-cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{"username":"trendy_treasures"}'
```

**Responses:**
- 200 — authorize succeeded; provider token stored.
- 404 — No `temp_clients` row found (TTL expired or it was never created).
- 401 — Auth returned 401 (invalid credentials, wrong redirect_uri).

### `GET /api/v1/user/admin/client/creds`

Lists the authorized provider credentials currently held in `creds`.

### `DELETE /api/v1/user/admin/client/creds/:id`

Deletes an authorized credential and clears the gateway's token cache for that `apiName`.

### `GET /api/v1/user/admin/users/get`

Lists users (paginated). Admin only.

### `DELETE /api/v1/user/admin/users/delete/:userId`

Deletes a user by email.

---

## 4. Cart

All routes require a shopper session.

### `GET /api/v1/user/cart/get`

```bash
curl https://<gateway>/api/v1/user/cart/get -b cookies.txt
```

```json
{
  "success": true,
  "cartItems": [
    {
      "_id": "...",
      "userId": "jane@example.com",
      "productName": "Wireless Mouse",
      "productPrice": 24.99,
      "productQuantity": 2,
      "productSoldBy": "Amazon",
      "source": "amazon",
      "providerProductId": "..."
    }
  ]
}
```

### `POST /api/v1/user/cart/add`

```bash
curl -X POST https://<gateway>/api/v1/user/cart/add \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{
    "productName": "Wireless Mouse",
    "productDescription": "...",
    "productImageUrl": "...",
    "productPrice": 24.99,
    "productQuantity": 1,
    "productSoldBy": "Amazon",
    "source": "amazon",
    "providerProductId": "..."
  }'
```

If an item with the same `productName` already exists, its quantity is incremented. Otherwise a new row is inserted.

### `PUT /api/v1/user/cart/update`

```bash
curl -X PUT https://<gateway>/api/v1/user/cart/update \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{"productName":"Wireless Mouse","productQuantity":3}'
```

### `DELETE /api/v1/user/cart/remove`

```bash
curl -X DELETE https://<gateway>/api/v1/user/cart/remove \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{"productName":"Wireless Mouse"}'
```

---

## 5. Checkout intents

### `POST /api/v1/user/checkout/intent` — Create a referral

Called by the storefront after the user clicks "Buy on X". CSRF is required; a session is optional (guest checkout is supported).

```bash
curl -X POST https://<gateway>/api/v1/user/checkout/intent \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{
    "provider": "amazon",
    "items": [{ "providerProductId": "...", "productName": "...", "productPrice": 24.99, "quantity": 2 }]
  }'
```

```json
{ "success": true, "referralCode": "TT-2BFC1250ED7F6C18", "provider": "amazon" }
```

### `GET /api/v1/user/checkout/intent/:referralCode`

Public — the provider checkout page calls this from the browser to read the intent. Returns no PII.

```json
{
  "referralCode": "TT-2BFC1250ED7F6C18",
  "provider": "amazon",
  "items": [...],
  "status": "redirected"
}
```

### `POST /api/v1/user/checkout/intent/:referralCode/complete`

Internal — called by Amazon or Walmart after order placement, with `x-internal-auth`. Marks the intent completed and **removes matching cart items**.

```bash
curl -X POST https://<gateway>/api/v1/user/checkout/intent/TT-XXX/complete \
  -H "x-internal-auth: <INTERNAL_AUTH_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"providerOrderId":"AMZ-12345"}'
```

---

## 6. Price tracking

### `GET /api/v1/user/prices/:provider/:productId/history?days=30`

Public price history. `days` is clamped server-side to 1–365.

```bash
curl "https://<gateway>/api/v1/user/prices/amazon/abc123/history?days=30"
```

```json
{
  "success": true,
  "history": [
    { "price": 24.99, "snapshotted_at": "2026-05-19T12:00:00Z" },
    { "price": 22.99, "snapshotted_at": "2026-05-19T18:00:00Z" }
  ]
}
```

### `POST /api/v1/user/prices/alerts`

Creates or updates one alert per `(buyer, provider, product)`. Requires a session.

```bash
curl -X POST https://<gateway>/api/v1/user/prices/alerts \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{"provider":"amazon","product_id":"abc","product_name":"Wireless Mouse","threshold_price":19.99}'
```

### `GET /api/v1/user/prices/alerts`

Lists the buyer's alerts.

### `DELETE /api/v1/user/prices/alerts/:id`

Deletes an alert owned by the buyer.

---

## 7. AI endpoints

Both endpoints are public (no auth required) but rate-limited.

### `GET /api/v1/user/ai/price-advice/:provider/:productId`

Returns a buy-or-wait recommendation based on the last 30 days of `price_snapshots`. Cached in memory for 6 hours per `(provider, productId)`.

```bash
curl https://<gateway>/api/v1/user/ai/price-advice/amazon/abc123
```

```json
{
  "success": true,
  "recommendation": "wait",
  "rationale": "Price has trended down 12% over the last two weeks; expect further drops.",
  "stats": { "current": 24.99, "min30": 22.99, "max30": 29.99, "avg30": 25.47 }
}
```

### `POST /api/v1/user/ai/product-qa`

Answers questions about a product using its metadata. The question and product description are length-capped before being sent to OpenAI.

```bash
curl -X POST https://<gateway>/api/v1/user/ai/product-qa \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{
    "question": "Is this compatible with Mac?",
    "product": { "name": "Wireless Mouse", "description": "..." }
  }'
```

### Configuration & graceful disable

Both endpoints live in the **Users** service and call OpenAI through a thin `fetch` wrapper (`Users/Services/AIService.js`).

| Env var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | _(empty)_ | OpenAI API key. **If unset, both endpoints return `503` and the storefront widgets render nothing** — the feature self-disables instead of showing a broken UI. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Chat Completions model. Swap in one env change. |

Notes:
- Calls have a **15-second timeout** (`AbortController`); a slow OpenAI response can't hang the buyer's request.
- `price-advice` is cached in memory for **6 hours** per `(provider, productId)`, aligned with the snapshot cadence. With **fewer than 3 snapshots** it returns a fixed "not enough data" message and **skips the model call** entirely.
- `product-qa` is **not** cached (questions vary) and length-caps the question (240 chars) and description (2000 chars) before sending.

---

## 8. Developer auth (Auth server)

The Auth server is called directly, not through the gateway. The base URL is `<auth>`.

### `POST /auth/register` / `POST /auth/register/verify`

Two-step developer signup with a hashed 6-digit OTP. Same shape as shopper signup, but the cookies are `pendingSignup` then `authToken` / `authRefreshToken`.

### `POST /auth/login`

```bash
curl -X POST https://<auth>/auth/login \
  -c cookies.txt -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"username":"jane_dev","password":"DevPass!1"}'
```

Returns `authToken` (15-minute TTL), `authRefreshToken` (7-day TTL with a `tv` claim), and a `csrfToken` cookie + body value.

### `POST /auth/credentials` — Create an API credential

```bash
curl -X POST https://<auth>/auth/credentials \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <token>" \
  -d '{
    "api_name": "Amazon_Products",
    "api_url": "https://<amazon>",
    "redirect_uri": "https://<users>/admin/auth/callback"
  }'
```

**Returns** the generated `client_id` and **the plaintext `client_secret`, exactly once**:
```json
{
  "success": true,
  "credential": {
    "_id": "...",
    "client_id": "auth_id_abc123",
    "client_secret": "secret_xyz...",
    "api_name": "Amazon_Products",
    "api_url": "https://<amazon>",
    "redirect_uri": "https://<users>/admin/auth/callback"
  }
}
```

Save the secret right away — Auth only stores the bcrypt hash.

### `POST /auth/credentials/:id/rotate-secret`

Generates a new plaintext secret, replaces the hash, and returns the new secret once.

### `DELETE /auth/credentials/:id`

Deletes the credential.

### `GET /auth/dashboard` / `GET /auth/creds/apiinfo/:id`

Read endpoints for the developer's credentials. Never return `client_secret_hash`.

### `POST /auth/authorize` — Server-to-server authorize

Called by Users' `/admin/auth` flow. Validates `clientId` + `clientSecret` + `redirect_uri` + `username`, signs a provider JWT, stamps `active_jti`, and POSTs `{ creds, accessToken }` to `redirect_uri` with `x-internal-auth`.

```bash
# Direct invocation (normally TrendyTreasures calls this server-to-server)
curl -X POST https://<auth>/auth/authorize \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "auth_id_abc123",
    "clientSecret": "secret_xyz...",
    "redirectUri": "https://<users>/admin/auth/callback",
    "username": "jane_dev"
  }'
```

### `POST /auth/token/refresh` — Gateway refresh

The gateway sends an RS256 assertion JWT here when a provider token expires. Auth verifies it with `GATEWAY_PUBLIC_KEY`, signs a new provider JWT, updates `active_jti`, and returns the new token.

Not normally called by hand.

### `GET /auth/token/active/:clientId` — Active-jti introspection

Internal. Called by provider middleware to check whether an incoming token's `jti` is still active.

```bash
curl https://<auth>/auth/token/active/auth_id_abc123 \
  -H "x-internal-auth: <INTERNAL_AUTH_SECRET>"
```

```json
{ "success": true, "active_jti": "35631fd1-..." }
```

### `GET /auth/client/login` / `POST /auth/client/login`

EJS-rendered consent page used during the OAuth-style authorize flow. GET renders the form; POST validates the developer's password and 302-redirects to the callback URL. See [`ARCHITECTURE.md` section 3.2](ARCHITECTURE.md#32-admin--auth-provider-authorization-the-oauth-style-flow).

---

## 9. Provider APIs

Amazon and Walmart expose the same shape. Substitute `<amazon>` for `<walmart>` and the responses are equivalent.

### `GET /api/v1/amazon/products/get` (via gateway)

Lists products. The gateway injects the provider JWT.

```bash
curl https://<gateway>/api/v1/amazon/products/get
```

### `GET /api/v1/amazon/products/:productId`

Returns one product. The gateway also captures a price snapshot if it's stale, and checks alerts.

### `GET /checkout?ref=TT-<code>` (direct, no gateway)

The provider checkout page. The browser navigates here after the handoff.

### `POST /payments/create-intent` (direct)

The provider creates a Stripe PaymentIntent. **The amount is recomputed on the server** from the intent's trusted items — not from anything the browser passed in.

```bash
curl -X POST https://<amazon>/payments/create-intent \
  -H "Content-Type: application/json" \
  -d '{
    "referralCode": "TT-...",
    "shippingAddress": { "name": "...", "street": "...", ... }
  }'
```

Returns the Stripe `client_secret` so the browser can confirm the payment.

### `POST /orders/place` (direct)

Called after Stripe confirms the payment on the client. Verifies the PaymentIntent with Stripe, checks the amount matches, saves the order + payment, and calls `/checkout/intent/:code/complete`.

```bash
curl -X POST https://<amazon>/orders/place \
  -H "Content-Type: application/json" \
  -d '{
    "referralCode": "TT-...",
    "paymentIntentId": "pi_..."
  }'
```

```json
{ "success": true, "providerOrderId": "AMZ-12345" }
```

### `GET /config.js`

Returns a small JS snippet that defines `window.STRIPE_PK`, `window.TT_GATEWAY_URL`, and `window.TRENDY_TREASURES_URL` for the checkout HTML to read.

```js
window.STRIPE_PK = "pk_test_...";
window.TT_GATEWAY_URL = "https://<gateway>";
window.TRENDY_TREASURES_URL = "https://<storefront>";
```

---

## 10. Internal service-to-service

Every endpoint below requires `x-internal-auth: <INTERNAL_AUTH_SECRET>` and fails closed if the env var is missing.

| Endpoint | Caller | What it does |
|---|---|---|
| `POST <users>/admin/auth/callback` | Auth server | Delivers a freshly signed provider token to Users |
| `POST <users>/checkout/intent/:code/complete` | Amazon / Walmart | Marks the intent done and clears the cart |
| `POST <users>/internal/price-drop` | Gateway | Triggers a Brevo notification email |
| `POST <gateway>/internal/snapshot-tracked` | Cron (optional) | Sweeps tracked products and writes snapshots |
| `DELETE <gateway>/internal/token-cache/:apiName` | Operator / Auth (on cred delete) | Force-clears the gateway's provider token cache |
| `GET <auth>/auth/token/active/:clientId` | Amazon / Walmart middleware | Active-jti introspection |

---

## 11. Error response shapes

Standard envelope used across all services:

```json
{ "success": false, "message": "<human-readable>" }
```

Status codes follow HTTP conventions:

| Code | What it means here |
|---|---|
| 400 | Invalid input (missing fields, wrong types, schema validation) |
| 401 | No valid session, or wrong session credentials |
| 403 | Authenticated but not authorized (admin route as shopper, CSRF mismatch, internal-auth mismatch) |
| 404 | Resource not found (intent, user, credential) |
| 409 | Conflict (email already registered) |
| 410 | Resource expired (OTP) |
| 429 | Rate-limited |
| 500 | Unhandled server error — check the logs |
| 503 | Service prerequisite missing (e.g. `INTERNAL_AUTH_SECRET` not set) |

In production, stack traces are not returned. The Auth server's global error handler ([Auth/server/app.js:154-165](../Auth/server/app.js#L154-L165)) returns a generic "Internal server error" with the request ID. The client should show "Something went wrong, request ID: ..." for support.

Anti-enumeration behavior on login and (where applicable) recovery: a single "Invalid credentials" / "If an account exists for this email, an OTP was sent" — never reveal which side actually failed.
