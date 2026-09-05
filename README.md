# TrendyTreasures — Microservice E-Commerce Platform

TrendyTreasures is an online storefront made up of **seven small services** that work together. Shoppers see a single catalog, but the products actually come from two simulated providers (Amazon and Walmart). When the shopper is ready to pay, TrendyTreasures hands them over to the provider's own checkout page — the provider takes the money and ships the order. TrendyTreasures itself never touches the payment.

> **Live deployment:** the storefront runs on Vercel, six backend services run on Render, data lives in MongoDB Atlas, payments go through Stripe (test mode), email is sent through Brevo, and AI features use OpenAI. For deeper details, see the [`docs/`](docs/) folder.

---

## What makes this project interesting

- **It mixes two programming languages.** Five services are written in Node.js + Express; one (Walmart) is written in Python + Flask. The two stacks talk to each other only through HTTP and signed JWTs, which proves the service boundaries really are language-agnostic.
- **Three separate login systems, on purpose.** Shoppers, admins, and developers each have their own login flow with their own secret keys. If one secret leaks, the other two are unaffected.
- **Asymmetric keys between the gateway and Auth.** The gateway signs with a private key; Auth verifies with a public key. So even if someone breaks into the Auth server, they still can't forge a new token without the gateway's private key.
- **Payment amounts are recomputed on the server.** The browser never tells the provider how much to charge — the server figures out the price from a trusted record. A user editing the page can't pay less than they owe.
- **Tokens can be revoked instantly.** Every provider token carries a `jti` (token ID). Re-authorizing rotates that ID, and any token with the old `jti` is rejected on the next call.
- **Cross-domain CSRF protection.** Because the storefront is on `*.vercel.app` and the API is on `*.onrender.com`, we use a "double-submit cookie" pattern where the CSRF token is also returned in the response body, since JavaScript can't read cookies across different registrable domains.

---

## 1. Architecture at a glance

```
                                   ┌──────────────────────┐
                                   │   Storefront SPA     │   Vercel
                                   │      (client/)       │
                                   └──────────┬───────────┘
                                              │  fetch (credentials: 'include')
                                              ▼
┌──────────────────────┐            ┌──────────────────────┐
│   Auth SPA           │            │     API Gateway      │   Render
│   (Auth/client/)     │            │    (APIGateway/)     │
└──────────┬───────────┘            └──────┬───────┬───────┘
           │ Vercel                        │       │
           ▼                               ▼       ▼
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│     Auth server      │    │    Users service     │    │   Amazon service     │
│   (Auth/server/)     │    │      (Users/)        │    │     (Amazon/)        │
│   Node + Express     │    │   Node + Express     │    │   Node + Express     │
└──────────┬───────────┘    └──────────┬───────────┘    └──────────┬───────────┘
           │                           │                ┌──────────┴───────────┐
           │                           │                │   Walmart service    │
           │                           │                │     (Walmart/)       │
           │                           │                │   Python + Flask     │
           │                           │                └──────────┬───────────┘
           │                           │                           │
           └───────────────────────────┴───────────────────────────┘
                                       │
                                       ▼
                          ┌──────────────────────────┐
                          │  MongoDB Atlas (4 DBs)   │
                          │ trendytreasures │ auth │ │
                          │  amazon    │ walmart     │
                          └──────────────────────────┘
```

### The seven services

| Service | Stack | What it does |
|---|---|---|
| `client/` | React 18 | Main storefront and admin pages |
| `Auth/client/` | React 18 | Developer-facing pages for managing API credentials |
| `APIGateway/` | Node + Express | The only public entry point for the storefront's API calls. Injects provider tokens; refreshes them when they expire. |
| `Users/` | Node + Express + Mongoose | Shopper and admin accounts, cart, checkout records, price alerts, AI features |
| `Auth/server/` | Node + Express + EJS | Developer accounts, API credential lifecycle, issuing provider JWTs |
| `Amazon/` | Node + Express + Stripe | Amazon-branded mock provider — products, checkout, orders |
| `Walmart/` | Python + Flask + Stripe + MongoEngine | Walmart-branded mock provider — same idea, different language |

### Things every service shares

| Feature | Where | What it does |
|---|---|---|
| API versioning | All gateway routes | All endpoints sit under `/api/v1/*`, so we can ship a v2 later without breaking old clients |
| Health endpoint | Every service | `GET /health` returns service name, uptime, and DB connection state |
| Request IDs | Gateway → all services | Every request gets an `x-request-id` UUID that shows up in every log line, so you can trace a single request across all services |
| Rate limiting | Each service | 120 requests/minute on most routes; tighter limits on login (30 / 15 min) and payments (20/min) |
| Refresh tokens | Users + Auth | Short-lived access tokens (1 hour) + 7-day refresh tokens |
| Provider-token caching | Gateway | 60-second in-memory cache so we don't read the DB on every product request |
| Helmet, CSRF, CORS | Every backend | Security headers, double-submit CSRF protection, strict origin allowlists |
| Docker support | All backends | Each service has its own `Dockerfile`; a top-level `docker-compose.yml` runs them all |

---

## 2. Folder layout

```
E_Commerce_Prod/
├── APIGateway/          The gateway — port 7000
├── Users/               Shopper and admin domain — port 7001
├── Auth/
│   ├── server/          Developer + provider credential server — port 5000
│   └── client/          Developer SPA — port 3002
├── Amazon/              Provider service — port 8000
├── Walmart/             Provider service (Python) — port 8001
├── client/              Storefront SPA — port 3001
├── docs/                Detailed documentation
│   ├── ARCHITECTURE.md     System diagrams and per-flow walkthroughs
│   ├── SECURITY.md         Threat model and OWASP control matrix
│   ├── API.md              Every endpoint with curl examples
│   └── DATA_MODEL.md       Database schemas and indexes
├── docker-compose.yml   Spins up all backends locally
├── genkeys.js           Helper to generate the gateway/Auth RSA keypair
└── README.md            This file
```

---

## 3. Technology used

| Layer | What we use |
|---|---|
| Frontend | React 18, React Router v6, react-toastify, Tailwind |
| Backends (5 services) | Node.js 20, Express 4 |
| Backend (1 service) | Python 3.12, Flask, MongoEngine |
| Gateway | Express + `http-proxy-middleware` v3 |
| Database | MongoDB Atlas — one database per service |
| Auth | JWTs (`jsonwebtoken`, `pyjwt`), bcrypt for passwords, RS256 keypair for gateway↔Auth, optional Google OAuth2 |
| Payments | Stripe (test mode), server-side amount verification |
| Email | Brevo's HTTPS API (Render's free tier blocks regular SMTP) |
| AI | OpenAI's `gpt-4o-mini` for price advice and product Q&A |
| Security | `helmet`, `express-rate-limit`, double-submit CSRF, httpOnly cookies, CSP form-action allowlist |

---

## 4. How logins work

There are three separate login systems, each with its own threat model.

| Who | Cookies | Access token lasts | Refresh token lasts | How sessions are killed |
|---|---|---|---|---|
| Shopper | `userToken` + `userRefreshToken` | 1 hour | 7 days | Wait for TTL |
| Admin | `adminToken` + `adminRefreshToken` | 1 hour | 7 days | Wait for TTL |
| Developer | `authToken` + `authRefreshToken` | 15 min | 7 days | `tokenVersion` bump on password change |
| Provider (server-only) | `productsauthorization` header — no cookies | 1 hour | RS256 assertion-driven refresh | Rotating `active_jti` on re-authorize |

**Cookie settings:** in production, all cookies are `HttpOnly`, `SameSite=None`, and `Secure` (the SPAs and APIs are on different domains). In dev, we use `SameSite=Lax`.

**CSRF:** we use a double-submit cookie pattern. The server returns the CSRF token in both a cookie and the response body, because cross-domain browsers can't read the cookie via `document.cookie`.

**Service-to-service:**
- **Gateway → Auth (token refresh):** uses an RS256-signed assertion. The gateway has the private key; Auth has only the public key. So Auth can verify but can't sign.
- **Everything else internal** (Auth ↔ Users, providers ↔ gateway, providers ↔ Auth): uses an `x-internal-auth` header carrying a shared secret. If the env var is missing, the request is rejected — never accepted by default.

---

## 5. Main user flows

### 5.1 Signing up (two-step with email OTP)

`POST /auth/signup` checks the form, sends a 4-digit code to the user's email, and sets a temporary `pendingSignup` cookie. **No user record is created yet.** Then `POST /auth/signup/verify` checks the code and creates the account. If the user abandons signup, nothing gets stored — the OTP just expires after 120 seconds.

### 5.2 An admin authorizes a provider's API

This is the flow that lets TrendyTreasures actually call the provider product APIs.

1. The developer creates a credential in the Auth SPA. They get back a `client_id`, `client_secret`, and `redirect_uri`.
2. The admin enters those values into `/admin/auth/request`. The Users service saves them temporarily in `temp_clients` (auto-deleted after 10 minutes).
3. The admin is redirected to Auth's consent page (rendered with EJS) and types the developer's username and password.
4. Auth verifies the credentials, signs a provider JWT, stamps the credential with `active_jti`, and POSTs `{ creds, accessToken }` to the redirect URL. That URL is a Users endpoint protected by `x-internal-auth`.
5. Users saves the token into the `creds` collection. From there, the gateway reads it on every product request (with a 60-second cache).

Full sequence diagram in [`docs/ARCHITECTURE.md` section 3.2](docs/ARCHITECTURE.md#32-admin--auth-provider-authorization-the-oauth-style-flow).

### 5.3 Loading products (with a transparent token refresh)

The gateway keeps provider tokens — the browser never sees them. If a provider rejects the token because it expired, here's what happens automatically:

1. The gateway grabs a lock for this `apiName` so multiple expiring requests don't all refresh at once.
2. It signs a short-lived RS256 assertion with its private key.
3. It calls `POST /auth/token/refresh` on the Auth server. Auth verifies the assertion with the public key, mints a new provider JWT, and rotates `active_jti`.
4. The gateway saves the new token, clears its 60-second cache, and retries the original product request.

From the shopper's point of view, the request just worked.

### 5.4 Cart → checkout → provider

1. The storefront groups cart items by which provider sells them.
2. It calls `POST /checkout/intent`, which creates a record with a `referralCode` (looks like `TT-<16 hex>`). This record has **no PII** — just product IDs and quantities.
3. The browser navigates to the provider's checkout page, passing `?ref=<code>`.
4. The provider checkout page calls back through the gateway to read the intent. The referral code is the capability — anyone with the code can read the intent.
5. The provider creates a Stripe PaymentIntent **using the items the gateway returned**, not anything from the browser.
6. The user pays via Stripe.js.
7. The provider asks Stripe to confirm the payment, saves the order locally.
8. The provider calls `/checkout/intent/:code/complete` on Users (with `x-internal-auth`).
9. Users marks the intent as completed and removes those items from the buyer's cart.

### 5.5 Price drop alerts

When someone loads a product detail page, the gateway also snapshots the current price (but only if the last snapshot is more than 6 hours old). If a snapshot crosses an alert threshold and the cooldown has passed, the gateway tells Users to email the buyer via Brevo.

### 5.6 AI features

- `GET /ai/price-advice/:provider/:productId` — uses 30 days of price snapshots to recommend "buy now" or "wait." Cached for 6 hours per product.
- `POST /ai/product-qa` — answers questions about a specific product using its metadata. Question and product description lengths are capped before being sent to OpenAI.

---

## 6. Database layout

Every service owns its own MongoDB database. The gateway shares the `trendytreasures` database with Users for shared data like `creds`, `price_snapshots`, and `price_alerts`.

| Database | Who owns it | Main collections |
|---|---|---|
| `trendytreasures` | Users (+ Gateway) | `users`, `cart`, `checkoutIntent`, `otp`, `temp_clients`, `creds`, `price_alerts`, `price_snapshots` |
| `auth` | Auth server | `clients` (developers), `credentials`, `authOtp` |
| `amazon` | Amazon service | `products`, `orders`, `payments`, `guestCustomers`, `addresses` |
| `walmart` | Walmart service | Same shape, with `Walmart_*` collection names |

> **Note on names:** in the code and connection strings, the first database is still called `ecommerce`. The docs call it `trendytreasures` because that matches the product name. They refer to the same physical database.

### A few design notes

- **`users`** stores both shoppers and admins. The `role` field tells them apart. The `email` field has a unique index.
- **`credentials.client_secret_hash`** is hidden by Mongoose's `select: false` so it never accidentally appears in API responses. `active_jti` is what we update when revoking tokens.
- **`otp` (TTL 120s)** and **`temp_clients` (TTL 600s)** clean themselves up using MongoDB's built-in TTL feature.
- **`checkoutIntent`** intentionally has no PII. The provider only sees product IDs and quantities. The `referralCode` is what links it to the order on the provider's side.
- **`creds`** has a unique compound index on `{client_id, api_name}` because the gateway reads it on every product request.

Full schemas and indexes are in [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

---

## 7. Notes on each service

### 7.1 API Gateway (`APIGateway/`)

- Proxies `/api/v1/user/*` to Users; `/api/v1/amazon/products*` and `/api/v1/walmart/products*` to the providers (after injecting the provider JWT).
- Refuses to start in production if any required env var is missing.
- Keeps a per-`apiName` map of in-flight refresh promises so a hundred concurrent requests share one refresh call.
- Saves price snapshots after each product-detail proxy response.

### 7.2 Users service (`Users/`)

- Routes are grouped under `/auth`, `/admin`, `/cart`, `/checkout`, `/account`, `/recovery`, `/prices`, `/ai`.
- The auth middleware tries `userToken` first, then `adminToken`, then the `Authorization` header. It also accepts Google `ya29.*` access tokens.
- Internal endpoints (`/internal/*`, `/admin/auth/callback`, `/checkout/intent/:code/complete`) skip the CSRF check because there's no session cookie on those calls.
- JSON body size capped at 32KB.

### 7.3 Auth server (`Auth/server/`)

- Renders an EJS consent page at `/auth/client/login` for the OAuth-style authorize flow.
- The CSP `form-action` directive needs the storefront origin in `FORM_ACTION_ORIGINS` for cross-origin form submission to work.
- Has the most extensive automated tests (Jest + Supertest): signup/login/refresh, CSRF, `tokenVersion` invalidation, fail-closed introspection, OAuth state validation, body-size caps.
- `/auth/token/refresh` only accepts requests signed with an RS256 assertion from the gateway.

### 7.4 Amazon and Walmart providers

These are functionally identical — same contracts, different languages:

- Product routes (`/get`, `/:id`) require a `productsauthorization` JWT verified locally with `SECRET` (same value as Auth's `JWT_PROVIDER_SECRET`).
- The JWT's `api_url` claim must match the request's `x-original-url` header (so an Amazon token can't be used on Walmart).
- The JWT's `jti` is checked against Auth's `/auth/token/active/:clientId` (cached 30 seconds per `clientId`).
- The checkout pages (`/checkout`, `/confirmation`) plus `/payments/create-intent` and `/orders/place` are public-but-referral-gated, and verify Stripe payments before saving the order.
- `/config.js` exposes only the Stripe **publishable** key, the gateway URL, and the storefront URL. The Stripe secret key stays server-side.

### 7.5 Storefront client (`client/`)

- The `apiFetch` wrapper handles `credentials: 'include'`, fetches a CSRF token, captures rotated tokens from response bodies, and automatically refreshes the session on a 401. **Never call `fetch` directly** — you'll skip the CSRF and refresh logic.
- A guest cart in `localStorage` is merged into the server cart when the user logs in.

### 7.6 Auth client (`Auth/client/`)

Five screens: register, login, dashboard, create credential, credential details. Session state is checked with `GET /auth/me` on page load.

---

## 8. Security highlights

| Concern | How we protect against it |
|---|---|
| Password storage | bcrypt (cost 10 for shoppers, cost 12 for developers) |
| Session theft | `HttpOnly` cookies, `SameSite=None; Secure` in production |
| CSRF | Double-submit cookie + `x-csrf-token` header; token also returned in response body for cross-domain SPAs |
| Cross-provider token reuse | JWT's `api_url` claim must match the request path |
| Stale or revoked provider tokens | Every request checks `active_jti` against Auth (cached 30s) |
| Refresh token leak (developer side) | Changing the password bumps `tokenVersion` and invalidates all outstanding refresh tokens |
| Payment amount tampering | Subtotal is recomputed server-side and compared to `paymentIntent.amount_received` |
| SSRF via `redirect_uri` | We check the URL against private IP ranges, both statically and after DNS resolution |
| Email enumeration on login | The same "Invalid credentials" response for "wrong password" and "unknown email" |
| Email enumeration on Auth recovery | Opaque "if an account exists, we sent a link" response |
| Brute force on login | Auth-route rate limit of 30 attempts per 15 minutes |
| Stripe abuse | Payments rate limit of 20/minute + referral-code validation |
| Internal endpoint impersonation | `x-internal-auth` shared secret, rejected if env var is missing |
| Gateway → Auth impersonation | RS256 asymmetric keys — Auth verifies but can't sign |

Known gaps and recommended fixes are documented in [`docs/SECURITY.md` section 6](docs/SECURITY.md#6-known-gaps-and-mitigations).

---

## 9. Environment variables

Every service has a `.env.example`. Production values are not in this repo.

| Service | Important required variables |
|---|---|
| `APIGateway/` | `MONGO_CONN`, `USERS_SERVICE_URL`, `AMAZON_SERVICE_URL`, `WALMART_SERVICE_URL`, `AUTH_SERVER_URL`, `INTERNAL_AUTH_SECRET`, `GATEWAY_PRIVATE_KEY`, `GATEWAY_ISSUER`, `CORS_ORIGINS` |
| `Users/` | `MONGO_CONN`, `JWT_SECRET`, `INTERNAL_AUTH_SECRET`, `AUTH_SERVER_URL`, `API_GATEWAY_URL`, `CLIENT_URL`, `BREVO_API_KEY`, `MAIL_FROM`, `OPENAI_API_KEY`, `CORS_ORIGINS` |
| `Auth/server/` | `MONGO_CONN`, `JWT_SECRET` (different from Users'), `JWT_PROVIDER_SECRET`, `GATEWAY_PUBLIC_KEY`, `TRUSTED_ISSUERS`, `INTERNAL_AUTH_SECRET`, `BREVO_API_KEY`, `MAIL_FROM`, `CORS_ORIGINS`, `FORM_ACTION_ORIGINS` |
| `Amazon/` & `Walmart/` | `MONGO_CONN`, `SECRET` (same as Auth's `JWT_PROVIDER_SECRET`), `AUTH_SERVER_URL`, `INTERNAL_AUTH_SECRET`, `TT_GATEWAY_URL`, `TRENDY_TREASURES_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `CORS_ORIGINS` |
| `client/` | `REACT_APP_API_URL`, `REACT_APP_AUTH_URL`, `REACT_APP_CLIENT_URL`, `REACT_APP_AMAZON_CHECKOUT_URL`, `REACT_APP_WALMART_CHECKOUT_URL` (all build-time) |
| `Auth/client/` | `REACT_APP_AUTH_URL` (build-time) |

**Which secrets must match across services:**

- `JWT_PROVIDER_SECRET` (Auth) = `SECRET` (Amazon) = `SECRET` (Walmart). If they don't match, every product request fails.
- `INTERNAL_AUTH_SECRET` must be the same on all five backends. If they don't match, internal callbacks silently fail (carts won't clear, alerts won't fire).
- `GATEWAY_PRIVATE_KEY` lives only on the gateway; `GATEWAY_PUBLIC_KEY` lives only on Auth. Generate them with `node genkeys.js`.
- Users' `JWT_SECRET` and Auth's `JWT_SECRET` are **two separate values** — same env var name, different domains.

### Google sign-in ("Continue with Google")

Both the storefront and AuthShield support Google sign-in. It is **optional** — leave the three `GOOGLE_*` vars empty and the button redirects to `?error=google_unconfigured` instead of breaking.

The two apps are **separate OAuth surfaces with separate user tables**, and this project uses a **separate OAuth client for each** (both live in the same Google Cloud project). A redirect URI added to one client does *not* apply to the other. Create them at [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) → *Create credentials* → *OAuth client ID* → *Web application*.

**Authorized redirect URIs** (all four, exactly — Google does prefix-free exact matching):

| App | OAuth client | Local | Production |
|---|---|---|---|
| Storefront (via gateway) | `...6paebbjvpk...` | `http://localhost:7000/api/v1/user/auth/google/callback` | `https://api-gateway-uwnd.onrender.com/api/v1/user/auth/google/callback` |
| AuthShield (direct) | `...cn48pr91cg...` | `http://localhost:5000/auth/google/callback` | `https://auth-service-0g7e.onrender.com/auth/google/callback` |

The redirect URI is a **backend** URL — that is where the code-for-token exchange happens, because that is the only place the client secret lives. The SPA's own `/auth/google/callback` route is where the *backend* sends the browser afterwards; it must never be registered with Google.

**Authorized JavaScript origins:**

| App | Local | Production |
|---|---|---|
| Storefront | `http://localhost:3001` | `https://ecommerce-test-qvvv.vercel.app` |
| AuthShield | `http://localhost:3002` | `https://ecommerce-test-lemon-xi.vercel.app` |

Then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in both `Users/.env` and `Auth/server/.env` (and in the matching Render service env for production). Each service gets **its own** client's ID/secret plus its own redirect URI from the table above. Set all three or none — a partially configured client aborts boot in production.

> **The storefront's redirect URI must point at the gateway, not at Users directly.** The SPA reaches Users through the gateway, so the OAuth round-trip has to end on the gateway's origin — otherwise the `user_google_oauth_state` cookie and the session cookies are set on a hostname the SPA never sends cookies to. Locally this is invisible (`localhost:7000` and `localhost:7001` share one cookie jar); on Render they are separate hosts and sign-in fails with `google_state_invalid`.

An email that already has a **password** account cannot be claimed via Google (`?error=email_already_registered`) — that guard exists on both services so nobody can take over an account by registering the matching Google address.

---

## 10. Running locally

### What you need

- Node.js 20+, Python 3.12, MongoDB (local or Atlas)
- Stripe test keys, a Brevo API key with a verified sender, an OpenAI key (only if you want to test AI features)

### Install dependencies

```powershell
# Node services
cd APIGateway   ; npm install ; cd ..
cd Users        ; npm install ; cd ..
cd Auth\server  ; npm install ; cd ..\..
cd Amazon       ; npm install ; cd ..
cd client       ; npm install ; cd ..
cd Auth\client  ; npm install ; cd ..\..

# Python service
cd Walmart      ; pip install -r requirements.txt ; cd ..
```

### Generate the gateway keypair

```powershell
node genkeys.js
```

Paste the **PRIVATE** key into `APIGateway/.env` as `GATEWAY_PRIVATE_KEY`. Paste the **PUBLIC** key into `Auth/server/.env` as `GATEWAY_PUBLIC_KEY`.

### Start everything

**With Docker Compose** (easier) — one command runs MongoDB and all five backends:

```powershell
docker compose up --build
```

Then in two more terminals:

```powershell
cd client       ; npm start    # storefront on :3001
cd Auth\client  ; npm start    # auth client on :3002
```

**Without Docker** — open seven terminals:

```powershell
cd APIGateway   ; node app.js  # :7000
cd Users        ; node app.js  # :7001
cd Auth\server  ; node app.js  # :5000
cd Amazon       ; node app.js  # :8000
cd Walmart      ; python app.py # :8001
cd client       ; npm start    # :3001
cd Auth\client  ; npm start    # :3002
```

### Check that everything is up

```powershell
curl http://localhost:7000/health    # gateway
curl http://localhost:7001/health    # users
curl http://localhost:5000/health    # auth-server
curl http://localhost:8000/health    # amazon
curl http://localhost:8001/health    # walmart
```

Each one returns `{ "status": "ok", "mongoState": 1 }`. To trace a single request across services, grep its `x-request-id`:

```
[gateway] [a1b2c3d4-...] GET /api/v1/user/auth/me
[users]   [a1b2c3d4-...] GET /auth/me
```

### Smoke test

1. Sign up at `/signup`, enter the OTP, land on `/home`.
2. Create the first admin (using curl, because no admin exists yet):
   ```bash
   curl -X POST http://localhost:7000/api/v1/user/admin/register \
     -H "Content-Type: application/json" \
     -d '{"name":"Admin","adminId":"you@example.com","password":"AdminPass!1"}'
   ```
3. Log in as the admin at `/admin/login` and walk through the provider authorize flow at `/admin/auth/request`.
4. Browse products → add to cart → checkout with the Stripe test card `4242 4242 4242 4242` → confirm the cart clears after the order completes.

---

## 11. Testing

The Auth server has the most complete test suite:

```powershell
cd Auth\server
npm test
```

It covers signup/login/me, generic error responses, refresh token rotation, `tokenVersion` invalidation, CSRF, opaque forgot-password, fail-closed introspection, OAuth state validation, body-size caps, and readiness checks.

The other services currently have placeholder test scripts. The next CI investment would be tests for the Gateway (token refresh and retry), Users (auth/CSRF/cart isolation/checkout), and the provider services (Stripe verification and idempotency).

---

## 12. Documentation map

This README is the overview. Deeper docs live in [`docs/`](docs/):

| File | What it covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System diagrams, sequence diagrams for every cross-service flow, service cards, shared concerns |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Assets and adversaries, STRIDE threat model, OWASP Top 10 controls, cryptography inventory, known gaps |
| [`docs/API.md`](docs/API.md) | Every endpoint with `curl` examples, success/error responses, internal service-to-service routes |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | ER diagrams per database, collection-by-collection notes, full index list |

---

## License

ISC (matches the existing `package.json` files).
