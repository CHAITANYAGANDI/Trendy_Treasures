# Architecture

> What the system looks like, why it's put together this way, and what each piece is responsible for.

## Table of contents

1. [System context (the big picture)](#1-system-context-the-big-picture)
2. [Container view (one level deeper)](#2-container-view-one-level-deeper)
3. [The main flows, as sequence diagrams](#3-the-main-flows-as-sequence-diagrams)
4. [Service cards](#4-service-cards)
5. [Concerns that touch every service](#5-concerns-that-touch-every-service)
6. [Deployment topology](#6-deployment-topology)

---

## 1. System context (the big picture)

TrendyTreasures is an aggregator. Shoppers see a single catalog, but the products actually come from two simulated providers (Amazon and Walmart). When a shopper is ready to buy, TrendyTreasures sends them over to the provider's own checkout — the provider runs the payment, takes the order, and stores the PII. TrendyTreasures itself never holds payment details or full customer records.

```mermaid
flowchart TB
    shopper((Shopper))
    admin((Storefront<br/>Admin))
    developer((API<br/>Developer))

    subgraph platform["TrendyTreasures Platform"]
        direction LR
        trendyTreasures["TrendyTreasures<br/><i>storefront + gateway</i>"]
        authPlatform["Auth Platform<br/><i>developer accounts +<br/>credential issuance</i>"]
    end

    subgraph providers["Simulated Providers"]
        direction LR
        amazonSys["Amazon<br/><i>catalog + checkout</i>"]
        walmartSys["Walmart<br/><i>catalog + checkout</i>"]
    end

    subgraph externals["External APIs"]
        direction LR
        stripeSys["Stripe"]
        brevoSys["Brevo"]
        openaiSys["OpenAI"]
        googleSys["Google OAuth"]
    end

    shopper --> trendyTreasures
    admin --> trendyTreasures
    developer --> authPlatform

    trendyTreasures -->|catalog + handoff| providers
    trendyTreasures -->|S2S authorize| authPlatform

    providers -->|payments| stripeSys
    trendyTreasures --> brevoSys
    trendyTreasures --> openaiSys
    trendyTreasures -.->|optional| googleSys
```

### Why this shape?

The aggregator-with-handoff design is better than two natural alternatives:

| Alternative | Why we don't do it | What we do instead |
|---|---|---|
| TrendyTreasures handles checkout itself | We'd be on the hook for PCI compliance, we'd be storing provider customer PII, and we'd be liable for transactions on someone else's catalog. That doesn't match the "aggregator" idea. | We create a referral code and send the browser to the provider's checkout. The provider owns the transaction. |
| TrendyTreasures copies the entire provider catalog into its own database every night | Data gets stale; inventory might be wrong at checkout. | We read product data through the gateway live (with a 60-second token cache) and save per-product price snapshots for history. |

---

## 2. Container view (one level deeper)

The platform is made up of **seven** deployable pieces, split across three trust domains. The gateway is the storefront's public API entry point. Auth is also public because AuthShield talks to it directly, and Amazon/Walmart are public because they host the branded checkout pages. All five backends currently run as public Cloud Run services with application-level authentication and rate limiting.

```mermaid
flowchart TB
    shopper((Shopper /<br/>Admin))
    developer((Developer))

    subgraph spas["Browser SPAs (Vercel)"]
        direction LR
        storefrontSpa["Storefront SPA<br/><i>React 18</i>"]
        authSpa["Auth SPA<br/><i>React 18</i>"]
    end

    subgraph backend["Backend Services (Google Cloud Run)"]
        direction TB
        gateway["API Gateway<br/><i>Node + Express</i>"]
        subgraph internal[" "]
            direction LR
            users["Users Service<br/><i>Node + Mongoose</i>"]
            authServer["Auth Server<br/><i>Node + EJS</i>"]
            amazon["Amazon Provider<br/><i>Node + Stripe</i>"]
            walmart["Walmart Provider<br/><i>Python + Flask</i>"]
        end
    end

    subgraph dbs["MongoDB Atlas"]
        direction LR
        trendytreasuresDb[("trendytreasures")]
        authDb[("auth")]
        amazonDb[("amazon")]
        walmartDb[("walmart")]
    end

    shopper ==> storefrontSpa
    developer ==> authSpa
    storefrontSpa ==>|HTTPS + cookies| gateway
    authSpa ==>|HTTPS + cookies| authServer

    gateway --> users
    gateway -->|provider JWT| amazon
    gateway -->|provider JWT| walmart
    gateway -->|RS256 assertion| authServer

    users -->|clientId/secret| authServer
    amazon -.->|x-internal-auth| authServer
    walmart -.->|x-internal-auth| authServer
    amazon -.->|x-internal-auth| gateway
    walmart -.->|x-internal-auth| gateway

    users --> trendytreasuresDb
    gateway --> trendytreasuresDb
    authServer --> authDb
    amazon --> amazonDb
    walmart --> walmartDb

    style internal fill:none,stroke:none
    classDef solid fill:#e8f0ff,stroke:#3b6fb6,stroke-width:1px
    classDef edge fill:#f4f4f4,stroke:#888,stroke-width:1px
    class gateway,users,authServer,amazon,walmart solid
    class storefrontSpa,authSpa edge
```

**Reading the diagram.** Solid arrows are normal request-path traffic. Dashed arrows are internal callbacks protected by `x-internal-auth`.

### How services authenticate to each other

| Caller → Callee | How | Notes |
|---|---|---|
| Browser → Gateway | Cookie session + CSRF | `SameSite=None; Secure` in production, since the SPA and API are on different domains |
| Gateway → Users | None today (private network would be ideal) | The gateway is fully trusted upstream of Users |
| Gateway → Amazon/Walmart | `productsauthorization: <provider-JWT>` | Token cached for 60s on the gateway |
| Gateway → Auth (token refresh) | RS256 assertion JWT (RFC 7523) | Gateway has the private key; Auth has only the public key |
| Users → Auth (authorize) | Plain `clientId` + `clientSecret` | One-shot during the admin authorize flow |
| Amazon/Walmart → Auth (introspect) | `x-internal-auth` header | Shared secret |
| Amazon/Walmart → Gateway (complete checkout) | `x-internal-auth` header | Same shared secret |
| GH Actions → Gateway (snapshot sweep) | `x-internal-auth` header | Optional scheduled job |

---

## 3. The main flows, as sequence diagrams

Six flows are worth tracing end to end. Each diagram below maps directly to the code, and line references appear next to each step.

### 3.1 Shopper signup (with email OTP)

```mermaid
sequenceDiagram
    actor U as Shopper
    participant SPA as Storefront SPA
    participant GW as Gateway
    participant US as Users
    participant DB as trendytreasures DB
    participant Brevo as Brevo

    U->>SPA: Fill signup form
    SPA->>GW: POST /api/v1/user/auth/signup
    GW->>US: POST /auth/signup
    US->>DB: Check user not exists
    US->>US: bcrypt(password)
    US->>DB: Upsert otp doc (purpose=signup, TTL 120s)
    US->>Brevo: Send 4-digit OTP email
    US->>SPA: Set pendingSignup cookie, 200 OK
    U->>SPA: Enter OTP
    SPA->>GW: POST /api/v1/user/auth/signup/verify
    GW->>US: POST /auth/signup/verify
    US->>US: Verify pendingSignup JWT
    US->>DB: Match OTP doc, check attempts
    US->>DB: Create user
    US->>SPA: Set userToken + userRefreshToken cookies
    US->>SPA: Clear pendingSignup
```

The signup is split into two steps because we **never want a user row in MongoDB unless the email has been verified**. If we created the row first, abandoned signups would pile up and we'd have to clean them later. Doing it this way means an unverified OTP just expires (the `otp` collection has a 120-second TTL), and no `users` document is ever created.

### 3.2 Admin → Auth provider authorization (the OAuth-style flow)

This is the trickiest flow in the system. It exists because the gateway needs a long-lived provider JWT to use when calling Amazon and Walmart, but that JWT must never touch the browser.

```mermaid
sequenceDiagram
    actor A as Admin
    participant SPA as Storefront SPA
    participant GW as Gateway
    participant US as Users
    participant AS as Auth Server
    participant DB as trendytreasures DB
    participant ADB as auth DB

    A->>SPA: Fill AuthRequest form (apiName, clientId, clientSecret, redirectUri)
    SPA->>GW: POST /api/v1/user/admin/client/details
    GW->>US: POST /admin/client/details
    US->>DB: Upsert temp_clients doc (TTL 10 min)
    US->>SPA: 201 OK

    SPA->>SPA: window.location = AUTH_SERVER/auth/client/login?<callbackUrl>&<client_id>
    A->>AS: Lands on EJS consent page
    AS->>ADB: Look up credential by client_id
    AS->>A: Render login.ejs (sets client_id cookie)

    A->>AS: Submit username + password
    AS->>ADB: bcrypt verify password against clients doc
    AS->>AS: Validate callbackUrl against CORS_ORIGINS
    AS->>A: 302 redirect to <CLIENT_URL>/admin/client/callback?username=...

    A->>SPA: Lands on ClientCallBack
    SPA->>GW: POST /api/v1/user/admin/auth { username }
    GW->>US: POST /admin/auth
    US->>DB: Find temp_clients by admin email
    US->>DB: Delete temp_clients row
    US->>AS: POST /auth/authorize { clientId, clientSecret, redirectUri, username }
    AS->>ADB: Find Client by username
    AS->>ADB: Find Credential by (client, client_id, redirect_uri)
    AS->>AS: bcrypt verify clientSecret against client_secret_hash
    AS->>AS: Sign provider JWT (JWT_PROVIDER_SECRET, includes jti)
    AS->>ADB: Stamp credential.active_jti = jti
    AS->>AS: Runtime SSRF check on redirectUri
    AS->>US: POST <redirectUri> { creds, accessToken } with x-internal-auth
    US->>DB: Upsert creds by (client_id, api_name) with new access_token
    US->>AS: 200 OK
    AS->>US: 200 OK
    US->>SPA: 200 OK
    SPA->>SPA: navigate('/admin/dashboard')
```

A few things worth pointing out:

- The `temp_clients` row has a **10-minute TTL** on `created_at`. If the admin takes longer than that (say, debugging a deployment), MongoDB silently deletes the row and the next `/admin/auth` call returns 404. This is a deliberate but slightly brittle safety net — see [Users/Models/Client.js:23-27](../Users/Models/Client.js#L23-L27).
- The `redirect_uri` does **double duty**: it's both the browser callback origin (validated in `OAuthLoginController`) and the server-to-server callback target (where Auth POSTs the token).
- `active_jti` is how we revoke tokens. Every authorize generates a new `jti`. Provider services compare the incoming token's `jti` against the credential's current `active_jti` and reject anything stale.

### 3.3 Loading a product (with a transparent token refresh)

The gateway holds provider tokens; the browser never sees them. If a provider rejects a token because it expired, the gateway refreshes and retries automatically.

```mermaid
sequenceDiagram
    actor U as Shopper
    participant SPA as Storefront SPA
    participant GW as Gateway
    participant AMZ as Amazon
    participant AS as Auth Server
    participant DB as trendytreasures DB
    participant ADB as auth DB

    U->>SPA: Open product list
    SPA->>GW: GET /api/v1/amazon/products/get
    GW->>DB: SELECT creds WHERE api_name=Amazon_Products (60s cache)
    GW->>AMZ: GET /get + productsauthorization: <JWT>
    AMZ->>AMZ: Verify JWT signature with SECRET
    AMZ->>AS: GET /auth/token/active/:clientId + x-internal-auth
    AS->>ADB: Look up active_jti
    AS->>AMZ: { jti }
    AMZ->>AMZ: Compare token.jti vs active_jti
    alt Token valid
        AMZ->>GW: 200 [products]
        GW->>SPA: 200 [products]
    else Token expired or superseded
        AMZ->>GW: 403 "Token has expired"
        GW->>GW: Lock per-apiName (avoid stampede)
        GW->>GW: Sign RS256 assertion JWT (GATEWAY_PRIVATE_KEY)
        GW->>AS: POST /auth/token/refresh + assertion
        AS->>AS: Verify assertion with GATEWAY_PUBLIC_KEY
        AS->>AS: Cache assertion jti (replay defense)
        AS->>ADB: Update credential.active_jti
        AS->>AS: Mint new provider JWT
        AS->>GW: { accessToken }
        GW->>DB: Upsert creds.access_token
        GW->>GW: Invalidate 60s cache entry
        GW->>AMZ: Retry GET /get + new JWT
        AMZ->>GW: 200 [products]
        GW->>SPA: 200 [products]
    end
```

Three properties worth calling out:

1. **The browser never sees the refresh.** The shopper never sees a 403 — they get products on the first try, even when the cached token was already expired.
2. **No refresh stampede.** If 50 product requests come in at the same time and they all see an expired token, only one refresh actually runs. The other 49 wait for it.
3. **Asymmetric trust.** Auth only has the public key, so even if someone breaks into Auth's environment, they still can't sign new assertions — they'd need the private key, which only lives on the gateway.

### 3.4 Checkout handoff to the provider

```mermaid
sequenceDiagram
    actor U as Shopper
    participant SPA as Storefront SPA
    participant GW as Gateway
    participant US as Users
    participant AMZ as Amazon
    participant Stripe as Stripe
    participant DB as trendytreasures DB
    participant ADB as amazon DB

    U->>SPA: Click "Buy on Amazon"
    SPA->>SPA: Filter cart to Amazon-only items
    SPA->>GW: POST /api/v1/user/checkout/intent
    GW->>US: POST /checkout/intent
    US->>US: Validate provider == 'amazon', items consistent
    US->>DB: Insert checkoutIntent { referralCode, items, userId, status: redirected }
    US->>SPA: { referralCode }

    SPA->>SPA: window.location = AMZ_CHECKOUT_URL?ref=<code>
    U->>AMZ: GET /checkout?ref=...
    AMZ->>U: Render checkout.html + checkout.js
    U->>GW: GET /api/v1/user/checkout/intent/:code (from browser via checkout.js)
    GW->>US: GET /checkout/intent/:code
    US->>DB: findOne by referralCode
    US->>U: { items, provider }

    U->>AMZ: Fills address, clicks Pay
    AMZ->>Stripe: PaymentIntents.create (amount from intent, not browser)
    Stripe->>AMZ: { client_secret }
    AMZ->>U: { client_secret }
    U->>Stripe: Confirm payment with Stripe.js
    Stripe->>U: succeeded
    U->>AMZ: POST /orders/place { paymentIntentId }
    AMZ->>Stripe: PaymentIntents.retrieve(id)
    Stripe->>AMZ: { status, amount, metadata }
    AMZ->>AMZ: Verify amount matches server-computed subtotal
    AMZ->>ADB: Insert order + payment + guestCustomer + address
    AMZ->>GW: POST /api/v1/user/checkout/intent/:code/complete + x-internal-auth
    GW->>US: POST /api/v1/user/checkout/intent/:code/complete + x-internal-auth
    US->>DB: Update intent.status = completed
    US->>DB: Delete matching cart items
    US->>AMZ: 200 OK
    AMZ->>U: 302 to /confirmation
```

The key security property here: **the buyer's browser never tells the provider how much to charge**. The amount in the PaymentIntent is recomputed on the server from the trusted `checkoutIntent.items` (which TrendyTreasures created and the provider read through the gateway). Even if someone tampers with the browser, they can't pay less than they owe.

### 3.5 How we prevent a token-refresh stampede

The gateway keeps an in-memory map of in-flight refreshes, keyed by `apiName`. If many product requests all see an expired token at the same time, they share a single refresh call.

```mermaid
sequenceDiagram
    participant R1 as Request 1
    participant R2 as Request 2
    participant R3 as Request 3
    participant GW as Gateway
    participant AS as Auth

    R1->>GW: GET /api/v1/amazon/products/get
    R2->>GW: GET /api/v1/amazon/products/123
    R3->>GW: GET /api/v1/amazon/products/456
    Note over GW: All three see cached token expired

    GW->>GW: refreshLock[Amazon_Products] = pendingPromise
    GW->>AS: POST /auth/token/refresh
    R2-->>GW: await refreshLock[Amazon_Products]
    R3-->>GW: await refreshLock[Amazon_Products]
    AS->>GW: { new accessToken }
    GW->>GW: refreshLock[Amazon_Products] resolves
    GW->>GW: Cache + DB update

    par
        GW->>R1: forward with new token
        GW->>R2: forward with new token
        GW->>R3: forward with new token
    end
```

This works inside a single process. If you run multiple gateway instances, each one will still refresh once per expiry window — fine for a 1-hour TTL (worst case is N instances refreshing once per hour). If you need tighter sharing across instances, put the refresh lock and token cache in Redis.

### 3.6 Price drop notification

```mermaid
sequenceDiagram
    participant U as Shopper (reads product)
    participant GW as Gateway
    participant AMZ as Amazon
    participant US as Users
    participant DB as trendytreasures DB
    participant Brevo as Brevo

    U->>GW: GET /api/v1/amazon/products/:id
    GW->>AMZ: GET /:id + provider JWT
    AMZ->>GW: 200 { product }
    GW->>U: 200 { product }
    GW->>DB: Insert price_snapshot if stale > 6h
    GW->>DB: Find alerts where provider+product_id matches
    alt Current price <= threshold AND cooldown elapsed
        GW->>US: POST /internal/price-drop + x-internal-auth
        US->>DB: Recheck threshold (defense in depth)
        US->>DB: Update alert.last_notified_at
        US->>Brevo: Send notification email
        US->>GW: 200 OK
    end
```

Two reasons we run this in the gateway, not in Users:

1. The gateway already has the product response in hand — saving a snapshot there avoids reading the product a second time.
2. Snapshotting piggybacks on existing reads instead of being a separate scheduled job. Less code, same result.

For products that have alerts but nobody's looked at lately, there's a cron-driven `POST /internal/snapshot-tracked` that sweeps them on a schedule.

### 3.7 AI price advisor & product Q&A

Two small AI features live in the Users service and read the **same** `price_snapshots` the chart is built from.

```mermaid
sequenceDiagram
    participant U as Shopper (product page)
    participant US as Users
    participant DB as trendytreasures DB
    participant AI as OpenAI

    U->>US: GET /ai/price-advice/:provider/:productId
    alt cached < 6h
        US->>U: 200 { advice, stats, cached:true }
    else
        US->>DB: Read last 30d of price_snapshots
        US->>US: Compute stats in code (min/max/median/percentile/trend)
        alt < 3 snapshots
            US->>U: 200 fixed "not enough data" (no model call)
        else
            US->>AI: system + stats-as-facts (max 80 tokens)
            AI->>US: 1–2 sentence buy/wait rec
            US->>U: 200 { advice, stats }
        end
    end
```

Design choices worth knowing:

1. **The math is done in code, not by the model.** `summarizeHistory()` computes min/max/median/percentile/trend and hands them to the model as *facts*. The model only phrases the buy-or-wait call — it can't get the arithmetic wrong, and the prompt stays short and cheap.
2. **Cheap-path short circuits.** A 6h in-memory cache and a "< 3 snapshots → skip the model" rule mean most reads never hit OpenAI.
3. **Q&A is grounded.** Product Q&A answers strictly from the supplied listing and is told to say "I don't see that detail" rather than invent one (see SECURITY.md §4 → AI endpoint guardrails).
4. **Self-disabling.** No `OPENAI_API_KEY` → endpoints return `503` → the storefront widgets render nothing. The feature is effectively a flag flipped by the presence of the key.

---

## 4. Service cards

Each service in one page: what it does, key files, dependencies, and things to watch out for.

### 4.1 API Gateway (`APIGateway/`)

**What it does:** the only public API surface for the storefront. Proxies requests to internal services, injects provider tokens on product reads, refreshes upstream JWTs when they expire, and captures price snapshots.

**Entry point:** [APIGateway/app.js](../APIGateway/app.js)

**Key files:**
- `app.js:546-549` — `/api/v1/user/*` proxy (rewrites the prefix, forwards to Users).
- `app.js:561-562` — `/api/v1/amazon/products*` and `/api/v1/walmart/products*` with token injection.
- Provider token cache (60s TTL) — an in-memory map keyed by `apiName`.
- Refresh lock — an in-memory `Map<apiName, Promise>`.

**What it doesn't own:**
- No user database. The gateway reads from `creds` in the `trendytreasures` database, but doesn't write user state.
- No business logic. Pure routing + cross-cutting concerns.

**Production env requirements:** RSA private key (`GATEWAY_PRIVATE_KEY`), upstream URLs, `INTERNAL_AUTH_SECRET`, Mongo connection string. The service refuses to start if any of these are missing in production.

**Things to watch out for:**
- The token cache is per-instance. If you scale horizontally, each instance refreshes independently.
- Because of the 60-second cache, credential rotation takes up to 60 seconds to fully propagate. To force it, call `DELETE /internal/token-cache/:apiName`.

### 4.2 Users (`Users/`)

**What it does:** owns all shopper and admin state — cart, checkout intents, account lifecycle, price alerts, AI endpoints.

**Entry point:** [Users/app.js](../Users/app.js)

**Collections it owns in the `trendytreasures` database:**
- `users` (shoppers + admins, distinguished by `role`)
- `cart`
- `checkoutIntent`
- `otp` (TTL 120s)
- `temp_clients` (TTL 600s)
- `creds` (shared with the gateway — gateway reads, Users writes)
- `price_alerts`, `price_snapshots` (also shared — gateway writes snapshots, Users reads alerts)

**Trust boundary:** Users trusts the gateway. It doesn't strictly check `Origin` because the gateway is its only public caller. Internal POSTs to `/internal/*` and `/checkout/intent/:code/complete` carry `x-internal-auth`.

**Things to watch out for:**
- Global CSRF middleware runs before routes (see [Users/app.js:139](../Users/app.js#L139)). Internal POSTs that don't have a CSRF cookie pair would normally be rejected, but the CSRF middleware short-circuits when there's no session cookie. That's a bit fragile — see [`SECURITY.md` section 6](SECURITY.md) for the recommended fix.
- `/admin/auth` deletes the `temp_clients` row **before** the upstream `/auth/authorize` call returns. If that upstream call fails (e.g. a brief network issue), the admin has to start over.

### 4.3 Auth server (`Auth/server/`)

**What it does:** identity provider for **developers** (not shoppers), and the issuer of provider JWTs.

**Entry point:** [Auth/server/app.js](../Auth/server/app.js)

**Collections in the `auth` database:**
- `clients` (developer accounts, separate from `users`)
- `credentials` (API credentials owned by a developer; carries the bcrypt-hashed `client_secret_hash`)
- `authOtp` (TTL 600s, hashed OTPs for signup and recovery)

**Two trust boundaries it bridges:**
1. **Developer → Auth:** standard session-cookie auth with CSRF, refresh tokens that carry `tokenVersion` for invalidation.
2. **Gateway → Auth (token refresh):** RS256 assertion JWT (RFC 7523 bearer profile). Auth has the public key; the gateway has the private key.

**Important controllers:**
- [Auth/server/Controllers/ClientAuthorizationController.js](../Auth/server/Controllers/ClientAuthorizationController.js) — handles both `/auth/authorize` (S2S with client credentials) and `/auth/token` (browser-authed). Signs provider JWTs with `JWT_PROVIDER_SECRET`.
- [Auth/server/Controllers/TokenRefreshController.js](../Auth/server/Controllers/TokenRefreshController.js) — verifies the gateway's RS256 assertion, signs a new provider JWT, rotates `active_jti`.
- [Auth/server/Controllers/TokenIntrospectController.js](../Auth/server/Controllers/TokenIntrospectController.js) — `GET /auth/token/active/:clientId` returns the current `active_jti`. Used by Amazon/Walmart to check if a token has been revoked.

**The EJS consent page:** [Auth/server/Views/login.ejs](../Auth/server/Views/login.ejs) is server-rendered because the SPA-to-SPA OAuth flow needs a same-origin form submission. The form POSTs to `/auth/client/login`, which validates the callback against `CORS_ORIGINS` and 302-redirects back to the storefront. The CSP `form-action` directive requires the storefront origin in `FORM_ACTION_ORIGINS`; see [Auth/server/.env.example:36-40](../Auth/server/.env.example#L36-L40).

### 4.4 Amazon provider (`Amazon/`)

**What it does:** simulates an upstream provider. Owns products, addresses, orders, and payments. Runs the Amazon-branded checkout pages.

**Entry point:** [Amazon/app.js](../Amazon/app.js)

**Two distinct surfaces:**
1. **Authenticated product API** (`/get`, `/:productId`) — requires `productsauthorization: <provider-JWT>`. Verified locally with `SECRET`; live `jti` check against Auth's introspection endpoint.
2. **Public checkout pages** (`/checkout`, `/confirmation`, `/payments/create-intent`, `/orders/place`) — meant for the browser after the handoff. The referral code is the capability.

**Provider JWT verification, step by step:**
1. Verify the signature using `SECRET` (which must equal Auth's `JWT_PROVIDER_SECRET`).
2. Check that the `api_url` claim matches the `x-original-url` header (so an Amazon token can't be used on Walmart).
3. Check that the `jti` claim matches Auth's current `active_jti` for that credential (cached 30s per `clientId`).

### 4.5 Walmart provider (`Walmart/`)

**Same role as Amazon**, just in a different language (Python/Flask) and ODM (MongoEngine instead of Mongoose). The contract — checkout pages, Stripe integration, provider JWT auth — is intentionally identical so the gateway can treat both providers the same way.

**Entry point:** [Walmart/app.py](../Walmart/app.py)

**Why two languages?** Two providers in two languages is the smallest setup that proves the boundary contracts (HTTP + JWT) really are stack-agnostic, which is the whole point of using microservices.

### 4.6 Storefront SPA (`client/`)

**What it does:** shopper UI + admin UI. React 18 (CRA via CRACO). Talks only to the gateway.

**Entry point:** [client/src/App.js](../client/src/App.js)

**Notable client-side concerns:**
- **CSRF setup:** [client/src/utils.js](../client/src/utils.js) wraps `fetch` in a helper called `apiFetch`. It fetches a CSRF token from `GET /api/v1/user/csrf-token` before the first state-changing request, captures any rotated tokens from response bodies, and retries with a fresh token if a request returns 403.
- **Refresh on 401:** `apiFetch` watches for 401s, calls `POST /api/v1/user/auth/refresh`, and retries the original request once.
- **Guest cart:** users who aren't logged in get a cart stored in `localStorage`. When they log in, it's merged into the server cart.
- **Two cookie domains:** the storefront SPA lives on Vercel (`*.vercel.app`) and the API lives on Google Cloud Run (`*.run.app`). These are different registrable domains, so `document.cookie` can't read the CSRF cookie. To work around that, the server also returns the token in the response body, and `apiFetch` caches it in memory.

### 4.7 Auth SPA (`Auth/client/`)

**What it does:** developer UI for registering a client account and creating, rotating, or deleting API credentials. Talks only to the Auth server.

**Entry point:** [Auth/client/src/App.js](../Auth/client/src/App.js)

This is the surface a developer uses **before** a TrendyTreasures admin authorizes their credentials. It's purely Auth-domain — no storefront access.

---

## 5. Concerns that touch every service

### 5.1 Authentication strategy

| Domain | Session cookies | Refresh mechanism | How refresh tokens get killed |
|---|---|---|---|
| Shopper (Users) | `userToken` (1h) + `userRefreshToken` (7d) | Both rotated on each refresh | None — relies on TTL |
| Admin (Users) | `adminToken` + `adminRefreshToken` | Same as shopper | None — relies on TTL |
| Developer (Auth) | `authToken` (15m) + `authRefreshToken` (7d) | Both rotated | `tokenVersion` on the `clients` doc — bumped on password change |
| Provider (Amazon/Walmart) | None — uses `productsauthorization: <JWT>` header | RS256-assertion-driven refresh via Auth | `active_jti` on the credential — re-authorize invalidates old tokens |

Three different refresh stories because the threat models are different. See [`SECURITY.md` section 3](SECURITY.md#3-authentication-architecture).

### 5.2 CSRF strategy

We use the **double-submit cookie pattern**, adapted for cross-domain (`*.vercel.app` ↔ `*.run.app`):

1. When the SPA starts → `GET /csrf-token` → server sets a `csrfToken` cookie **and** returns the same value in the response body.
2. The SPA caches the body value in memory (because cross-domain code can't read the cookie).
3. State-changing requests send `x-csrf-token: <value>` in the header.
4. The server compares the header to the cookie. They must match.

The CSRF middleware short-circuits when there's no session cookie present, so anonymous endpoints (initial signup, for instance) work without CSRF. As soon as the user has any auth cookie, CSRF becomes mandatory.

### 5.3 CORS strategy

Each service has a strict `CORS_ORIGINS` allowlist with `credentials: true`. The allowlist needs to include:

- The service's **own URL** (browsers send `Origin` even on same-origin POSTs).
- Every browser origin that calls it (storefront, auth client, both checkout pages).

Tradeoff: this means deploying to a new Vercel preview URL requires updating the allowlist. Use Vercel **production aliases** to avoid this — they have stable hostnames.

### 5.4 Rate limiting

Per-service, in-memory rate limits via `express-rate-limit`:

| Surface | Default | Why |
|---|---|---|
| Gateway general | 120/min | Public surface, generous enough for catalog browsing |
| Gateway auth routes | 30 per 15min | Brute-force defense for login/signup/recovery |
| Users general | 120/min | Defense in depth in case the gateway is bypassed |
| Auth server global | 200 per 15min | Developer surface, lower traffic |
| Provider general | 120/min | Mirrors the gateway |
| Provider payments | 20/min | Stripe round-trips cost money if abused |

These limits are **per-instance**. The current Cloud Run deployment caps each backend at one instance so the configured limits and in-memory replay/cache semantics remain exact. Before horizontal scaling, move the shared counters/caches to Redis or another centralized store.

### 5.5 Request correlation

Every request gets an `x-request-id`:
- The first service to see the request generates it (usually the gateway).
- It's forwarded through every server-to-server call.
- Every log line in every service prints it: `[<service>] [<request-id>] <method> <path>`.

To trace a single browser request through all five services, grep for the `x-request-id` value (returned in response headers, visible in DevTools).

---

## 6. Deployment topology

```mermaid
flowchart TB
    browser([Browser])

    subgraph CDN["Vercel"]
        direction LR
        clientStatic["Storefront SPA"]
        authClientStatic["AuthShield SPA"]
    end

    subgraph CloudRun["Google Cloud Run — northamerica-northeast2"]
        direction TB
        gw["API Gateway"]
        subgraph svcs[" "]
            direction LR
            users["Users"]
            authsrv["Auth Server"]
            amazon["Amazon Provider"]
            walmart["Walmart Provider"]
        end
    end

    subgraph GoogleInfra["Google Cloud platform services"]
        direction LR
        secrets["Secret Manager"]
        build["Cloud Build"]
        registry["Artifact Registry"]
    end

    subgraph Atlas["MongoDB Atlas"]
        direction LR
        trendytreasures[("trendytreasures")]
        authdb[("auth")]
        amazondb[("amazon")]
        walmartdb[("walmart")]
    end

    subgraph External["External APIs"]
        direction LR
        stripe["Stripe"]
        brevo["Brevo"]
        openai["OpenAI"]
        google["Google OAuth"]
    end

    github["GitHub Actions<br/>6-hour snapshots"]

    browser ==> CDN
    browser ==>|cookies| gw
    browser ==>|cookies| authsrv
    browser ==> amazon
    browser ==> walmart
    gw --> users
    gw --> amazon
    gw --> walmart
    gw --> authsrv
    users --> trendytreasures
    gw --> trendytreasures
    authsrv --> authdb
    amazon --> amazondb
    walmart --> walmartdb
    secrets -.-> gw
    secrets -.-> users
    secrets -.-> authsrv
    secrets -.-> amazon
    secrets -.-> walmart
    build --> registry
    registry -.-> CloudRun
    github --> gw
    amazon --> stripe
    walmart --> stripe
    users --> brevo
    users --> openai
    users --> google
    authsrv --> google

    style svcs fill:none,stroke:none
```

**Reading the diagram.** Bold arrows are browser-originated HTTPS traffic. Thin arrows are server-to-server/database/API calls. Dotted arrows represent platform configuration or image/secret delivery.

**Current production platform:**

- **Vercel for SPAs** — CDN-hosted React builds.
- **Cloud Run for backends** — one container per service in `northamerica-northeast2`.
- **Secret Manager** — production runtime secrets are injected into Cloud Run; each backend has a dedicated runtime service account.
- **Cloud Build + Artifact Registry** — source deployments build and store container images before Cloud Run creates a revision.
- **Atlas for data** — managed MongoDB. Current connectivity is public; stronger hardening would add static Cloud Run egress and a narrow Atlas IP allowlist.
- **Stripe for payments** — test mode for the portfolio deployment.
- **Brevo for email** — HTTPS transactional mail for OTP/recovery/alerts.
- **GitHub Actions** — calls `/internal/snapshot-tracked` every six hours using repository secrets.

**Current Cloud Run operational choices:**

- All five backends use `DEPLOYMENT_PLATFORM=cloud-run`.
- All five currently use `--max-instances 1` because rate-limit counters, replay protection, and several caches are in memory.
- The services use `--allow-unauthenticated` while application-level auth, CORS, and rate limiting enforce the current trust boundaries.
- Gateway, Users, Amazon, Walmart, and Auth each have a dedicated runtime service account.
- Gateway/Users share the storefront MongoDB database; Auth, Amazon, and Walmart each have their own database.

**Next hardening steps:**

- Move cross-instance counters/caches/replay state to Redis before increasing instance counts.
- Use IAM-authenticated service-to-service calls and/or private ingress for services that do not need direct browser access.
- Give Cloud Run a static egress IP through VPC + Cloud NAT, then restrict Atlas Network Access.
- Put an external HTTPS load balancer + Cloud Armor in front of the gateway if stronger edge controls are needed.
- Add centralized log-based alerts for authentication, payment, and security events.

See [`../CLOUD_RUN_DEPLOYMENT.md`](../CLOUD_RUN_DEPLOYMENT.md) for the production runbook.
