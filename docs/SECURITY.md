# Security

> What we're trying to protect, who we're trying to protect it from, and where each control lives in the code.

## Table of contents

1. [What we're protecting and who from](#1-what-were-protecting-and-who-from)
2. [Threat model (STRIDE)](#2-threat-model-stride)
3. [Authentication architecture](#3-authentication-architecture)
4. [OWASP Top 10 controls](#4-owasp-top-10-controls)
5. [Cryptography inventory](#5-cryptography-inventory)
6. [Known gaps and how we'd fix them](#6-known-gaps-and-how-wed-fix-them)
7. [Incident response triggers](#7-incident-response-triggers)

---

## 1. What we're protecting and who from

### Assets, ranked by how bad it would be to lose them

| Asset | Where it lives | What happens if we lose it |
|---|---|---|
| **Provider access tokens** (`creds.access_token`) | Gateway DB + 60s memory cache | Attacker can read provider catalogs as TrendyTreasures until the token expires (1h) or `active_jti` rotates. |
| **`GATEWAY_PRIVATE_KEY`** | Google Secret Manager → Gateway runtime env | Attacker can sign new gateway assertions and refresh tokens at will. Effectively unlimited access until we rotate the keypair. |
| **`JWT_PROVIDER_SECRET`** | Google Secret Manager → Auth/Amazon/Walmart runtime env | Attacker can forge provider JWTs that Amazon and Walmart will accept. |
| **`INTERNAL_AUTH_SECRET`** | Google Secret Manager → all five backend runtime envs | Attacker can call internal endpoints (price-drop notify, checkout-complete, token-cache flush, active-jti introspect). Bypasses CSRF and admin gates on those routes. |
| **Shopper / admin / developer passwords** | bcrypt hashes in MongoDB | Credential stuffing if users reuse passwords elsewhere. |
| **Shopper PII** (email, name, cart) | `users`, `cart`, `checkoutIntent` collections | Email harvesting + visibility into cart contents. |
| **Stripe API key** | Google Secret Manager → provider runtime env | Real-money payment intents, refund manipulation. |

### Who we worry about

| Adversary | What they have | What they want |
|---|---|---|
| **Drive-by web attacker** | A malicious page that the user happens to visit | Steal session cookies via XSS/CSRF and impersonate the victim |
| **Network attacker** | Can see traffic between browser and server | Read tokens off the wire |
| **Authenticated shopper** | A valid user session | Read another user's cart or orders (IDOR); underpay; access admin routes |
| **Authenticated admin** | A valid admin session | Anything inside their authority is fine. Out of scope unless they escalate beyond TrendyTreasures itself. |
| **Malicious developer** | A `clients` row in Auth | Steal another developer's API credential; SSRF against internal services via `redirect_uri` |
| **Insider with cloud configuration access** | Can read Vercel build config or over-privileged Google Cloud/Secret Manager data | Pivot to user data; mint tokens; impersonate services |
| **Stripe-malicious buyer** | Tampering with the Stripe.js flow client-side | Underpay; replay a successful PaymentIntent against multiple orders |

### Things we deliberately don't try to protect against

- Someone physically stealing the deployer's laptop.
- Supply-chain compromise of npm or PyPI packages (a real risk, but we mitigate by running `npm audit` regularly, not by adding custom controls).
- Google Cloud, Vercel, Atlas, Stripe, Brevo, or OpenAI being compromised themselves.

---

## 2. Threat model (STRIDE)

STRIDE is a checklist invented at Microsoft: **S**poofing, **T**ampering, **R**epudiation, **I**nformation disclosure, **D**enial of service, **E**levation of privilege. Each row below names a threat, the asset it targets, the main control that mitigates it, and any residual risk that's still left over.

### 2.1 Spoofing — pretending to be someone you're not

| # | Threat | Asset | Control | Residual risk |
|---|---|---|---|---|
| S1 | Attacker logs in as a shopper without knowing the password | Shopper session | bcrypt password hashing + login rate limit (30 attempts / 15 min) + httpOnly session cookies + email-OTP for password reset | Credential stuffing if the user reuses passwords; no MFA |
| S2 | Attacker pretends to be the gateway when calling Auth's `/auth/token/refresh` | Provider tokens | RS256 assertion JWT signed with the private key (only the gateway has it); replay protection via in-memory `jti` cache; `iss` must be in `TRUSTED_ISSUERS` | The replay cache is per-instance — a multi-instance Auth could in theory accept the same assertion twice |
| S3 | Attacker pretends to be a provider when calling the gateway's checkout-complete endpoint | Cart cleanup; intent status | `x-internal-auth: <INTERNAL_AUTH_SECRET>` required on `POST /checkout/intent/:code/complete`. Fails closed if the secret env is missing. | Shared-secret model — a leak compromises all service-to-service trust |
| S4 | Attacker pretends to be Auth when calling Users' `/admin/auth/callback` | Provider tokens | Same `x-internal-auth` check | Same as S3 |
| S5 | Browser attacker forges an `Origin` header | CORS allowlist | Browsers don't let scripts set `Origin` — it's enforced by the browser itself. Only relevant for non-browser attackers, who don't go through CORS preflights anyway. | Not really a threat |

### 2.2 Tampering — modifying data in transit or at rest

| # | Threat | Asset | Control | Residual risk |
|---|---|---|---|---|
| T1 | Browser tampers with the PaymentIntent amount | Money | Amazon and Walmart `/orders/place` retrieve the PaymentIntent from Stripe and check that `amount_received` matches the subtotal recomputed from `checkoutIntent.items` | None — the server is the source of truth |
| T2 | Browser tampers with cart prices in localStorage (guest cart) | Provider catalog integrity | Server re-fetches product prices through the gateway when computing the checkout subtotal | None |
| T3 | Browser tampers with the admin role in a JWT | Admin access | JWT signature is verified with `JWT_SECRET`; `role` claim must equal `Admin` | Only as strong as the secrecy of `JWT_SECRET` |
| T4 | Attacker modifies `creds.access_token` directly in the database | Provider tokens | DB access requires Atlas credentials. The current Cloud Run deployment uses public Atlas connectivity, so credential secrecy/TLS are critical. Harden with static Cloud Run egress plus a narrow Atlas IP allowlist. | Higher than a private-network design while Atlas accepts broad public ingress |

### 2.3 Repudiation — claiming you didn't do something you did

| # | Threat | Asset | Control | Residual risk |
|---|---|---|---|---|
| R1 | User claims they never placed an order | Provider order records | Order rows include the Stripe `paymentIntentId`, `transactionId`, `amount`, and status; Stripe is the canonical witness | None worth worrying about |
| R2 | Developer claims they never created a credential | Audit trail | `credentials.creation_date` is recorded; no signing/audit log beyond that | Can't prove which IP / at what time at a finer grain |
| R3 | Admin denies authorizing a provider | Audit trail | None — there's no admin audit log | Real gap. Add an admin-action log if compliance matters. |

### 2.4 Information disclosure — leaking data

| # | Threat | Asset | Control | Residual risk |
|---|---|---|---|---|
| I1 | Provider JWT leaks to the browser via a response body | Provider tokens | Tokens are injected by the gateway as a request header; they're never returned to the browser. `Users/Controllers/CheckoutIntentController.js` returns only non-PII intent fields. | None |
| I2 | Stripe secret key leaks to the browser | Money | Only `STRIPE_PUBLISHABLE_KEY` is exposed via `/config.js`. `STRIPE_SECRET_KEY` stays server-side. | None |
| I3 | Password recovery lets attackers guess which emails are real | Email privacy | Auth server returns generic "OTP sent if account exists" for unknown emails. **Users service currently returns 404 `User not found`** — known gap. | High on the shopper side; fix tracked. |
| I4 | Login response distinguishes "wrong password" from "no such user" | Email enumeration | Login returns generic "Invalid credentials" for both cases | None |
| I5 | Stack traces leak in production errors | Internal details | Auth server's global error handler hides `err.stack` when `NODE_ENV=production` and returns generic "Internal server error" body | The other services follow the same pattern but it's not centralized |
| I6 | OTP code is visible in the attacker's email if they own the mailbox | OTP secrecy | Out of scope — we assume the mailbox belongs to the user. | Mailbox compromise equals account compromise. Industry-standard assumption. |

### 2.5 Denial of service — making the system unavailable

| # | Threat | Asset | Control | Residual risk |
|---|---|---|---|---|
| D1 | Login brute force / credential stuffing | Login availability + accounts | Auth-route rate limit (30 / 15 min) + generic error responses | A determined attacker can spread across IPs |
| D2 | Stripe abuse via `/payments/create-intent` | Stripe quota + money | Payments rate limit (20/min/IP), referral-code validation, Stripe SDK timeouts | Stolen referral codes could amplify abuse |
| D3 | Token-refresh stampede on cold start | Auth server load | Per-`apiName` lock in the gateway | A multi-instance gateway means multiple concurrent refreshes |
| D4 | OTP spam | Brevo quota + user mailbox | The `otp` collection has a unique index on `(email, purpose)` — a second signup attempt updates rather than creates a row. Brevo also enforces send limits. | A malicious actor cycling through new emails can drain Brevo quota |
| D5 | Body-bomb DoS | Memory | `bodyParser.json({ limit: '32kb' })` on Users; `'16kb'` on Auth | Many small requests still get through, but they're covered by rate limits |

### 2.6 Elevation of privilege — getting more access than you should have

| # | Threat | Asset | Control | Residual risk |
|---|---|---|---|---|
| E1 | Shopper accesses admin routes | Admin functionality | `ensureAdminAuthorized` middleware on every admin route — verifies the `adminToken` JWT and checks `role === 'Admin'` | Only as strong as the secrecy of `JWT_SECRET` |
| E2 | First-admin bootstrap abuse | Becoming the first admin | The bootstrap endpoint is open **only when zero admins exist**. After the first successful registration, all further admin creates require admin auth. | Race condition: if no admin is registered immediately after deploy, whoever hits the endpoint first becomes admin |
| E3 | IDOR on the cart — reading/modifying another user's cart | Cart privacy | Cart routes derive `userId` from `req.user.email` (the JWT subject), never from the request body. The caller can't pass another email. | None on the cart. Other resources should be audited. |
| E4 | Admin authorizes a credential they don't own | Provider access on another developer's API | `/auth/authorize` requires the `clientSecret` to match the credential's `client_secret_hash`. Without the secret, no authorize. | The admin still needs the secret from somewhere outside the system |
| E5 | SSRF via `redirect_uri` to reach internal services | Internal network | Auth's `assertSafeOutbound` resolves the DNS at runtime and rejects private/loopback ranges. A static check first rejects non-https URLs in prod. | DNS rebinding is still possible against borderline destinations |

---

## 3. Authentication architecture

There are three separate login systems in the deployment. Each was designed for the threat model of who calls it.

### 3.1 Shopper / admin (Users service)

**Cookies:**
- `userToken` — JWT signed with HS256 using `JWT_SECRET`. TTL **1 hour**. Payload: `{ _id, email, name, role, type: 'access' }`.
- `userRefreshToken` — same key, TTL **7 days**. Payload: `{ _id, email, type: 'refresh' }`.
- `adminToken` / `adminRefreshToken` — parallel pair for admin sessions.

**Refresh:** `POST /auth/refresh` reads the refresh cookie, verifies the signature and `type === 'refresh'`, then mints new tokens. The new cookies use the same `HttpOnly; SameSite=None; Secure` flags.

**Invalidation:** none beyond TTL. A stolen refresh token works until it expires. **This is a known gap** — see [section 6](#6-known-gaps-and-how-wed-fix-them).

**Why we didn't fix it:** adding server-side refresh-token tracking (a token-family table) means a DB write on every refresh and makes logout much more complicated. For a class project / portfolio system this trade-off is acceptable; for prod with real money, add it.

### 3.2 Developer (Auth server)

**Cookies:**
- `authToken` — TTL **15 minutes**. Shorter than the shopper token because the developer surface manages **secrets** (creating, rotating, deleting credentials).
- `authRefreshToken` — TTL **7 days**. Includes a `tv` (token version) claim.

**Refresh:** `POST /auth/refresh` checks the signature and type **and** verifies `decoded.tv === client.tokenVersion`. Bumping `tokenVersion` on the `clients` document invalidates all of that developer's outstanding refresh tokens.

**When does `tokenVersion` get bumped?** On every password change. So changing your password kills every other open session — including any device that stole your refresh token.

**Why developers get this and shoppers don't:** the developer surface holds the API credentials that grant access to provider tokens. The blast radius of a stolen developer session is much bigger than a stolen shopper session.

### 3.3 Provider (Amazon / Walmart)

**No cookies.** Provider services don't have a buyer identity to authenticate against — they receive a referral code from TrendyTreasures and use that as a one-time capability.

**The provider API auth** (the only authenticated path) uses `productsauthorization: <provider-JWT>`:
- Signed with HS256 by Auth using `JWT_PROVIDER_SECRET`.
- Verified locally by Amazon/Walmart using `SECRET` (must equal `JWT_PROVIDER_SECRET`).
- Carries `client_id`, `api_url`, `api_name`, `type: 'client-access'`, and `jti`.
- Path scoping: the token's `api_url` claim must match the request's `x-original-url` header.
- Revocation: the token's `jti` must match Auth's current `active_jti` for that credential (introspected with a 30-second cache).

**Why HS256 here but RS256 between the gateway and Auth?**
- Provider services need a shared secret because Auth signs and the provider verifies — a symmetric relationship.
- Gateway-to-Auth has an asymmetric requirement: the gateway *signs*, Auth *verifies*, and we want a compromise of Auth to **not** let the attacker mint new tokens. That requires asymmetric crypto.

### 3.4 Service-to-service

| Pair | How | Why |
|---|---|---|
| Gateway → Users | Nothing today (private network would be ideal) | Same trust domain |
| Gateway → Amazon/Walmart | Provider JWT in request header | The provider validates downstream |
| Amazon/Walmart → Auth (introspect) | `x-internal-auth` header | Symmetric is fine — the provider only reads, never writes Auth state |
| Amazon/Walmart → Gateway (complete checkout) | `x-internal-auth` header | Same reason |
| Gateway → Auth (token refresh) | **RS256 assertion JWT** | Asymmetric — Auth can verify but not sign |
| Cron → Gateway (snapshot sweep) | `x-internal-auth` header | One-way trust |

`INTERNAL_AUTH_SECRET` is shared across **every** service. If it's compromised, all service-to-service impersonation becomes possible. Use per-pair secrets if scaling.

---

## 4. OWASP Top 10 controls

This maps the 2021 OWASP Top 10 to the actual controls in the code.

| # | Risk | Status | Controls |
|---|---|---|---|
| A01 | Broken Access Control | **OK with one gap** | JWT-signed sessions; admin role check on every admin route; cart owner derived from the session, not the body (E3 mitigated). **Gap:** no audit log for sensitive admin actions (R3). |
| A02 | Cryptographic Failures | **OK** | bcrypt for passwords (cost 10 for shoppers, 12 for developers); HS256 JWTs with secrets at least 32 chars (enforced on prod boot); RS256 keypair for gateway assertions; HTTPS terminated by Cloud Run/Vercel; production secrets stored in Google Secret Manager and never logged. |
| A03 | Injection | **OK** | Mongoose and MongoEngine parameterize queries; no raw `$where`. Body parsers have size caps. No `eval` or `Function(string)`. EJS templates use `<%=` (escaped) for user-supplied values. |
| A04 | Insecure Design | **Partially addressed** | The OAuth-style authorize flow uses a one-shot client secret, short-lived `temp_clients` rows, and JTI rotation. **Gap:** `temp_clients` is deleted before the upstream Auth call succeeds (`Users/Middlewares/authenticate.js:36`), so a network blip leaves the user re-entering creds. |
| A05 | Security Misconfiguration | **OK** | `helmet` defaults on every Express service; CSP with form-action allowlist on Auth; `requireProdEnv` boot check fails fast if any prod env var is missing; `NODE_ENV=production` controls secure-cookie behavior. |
| A06 | Vulnerable Components | **Manual** | No automated `npm audit` / `safety` in CI today. Run on a regular cadence and pin dependency versions. |
| A07 | Identification and Authentication Failures | **OK** | Rate-limited login (30/15min); generic error responses; OTP-gated signup; `httpOnly` + `SameSite=None` + `Secure` session cookies in prod; CSRF on state-changing routes; opaque password recovery (Auth) — **but Users recovery is non-opaque, known gap (I3).** |
| A08 | Software and Data Integrity Failures | **Partially** | Stripe PaymentIntent verification on `/orders/place` prevents amount tampering (T1). Provider JWT `jti` rotation prevents stale-token replay. **No supply-chain attestations** (no signed package verification, no SBOM). |
| A09 | Security Logging and Monitoring Failures | **Gap** | Request IDs are propagated across services; structured logging in Auth; raw `console.log` elsewhere. **No central log aggregation, no security event alerts.** |
| A10 | Server-Side Request Forgery | **OK** | `assertSafeOutbound` on the Auth server validates `redirect_uri` against private IP ranges (static check + runtime DNS resolution). |

### AI endpoint guardrails

The two public AI endpoints (`/ai/price-advice`, `/ai/product-qa`) talk to an external LLM, so they get their own abuse-resistance measures on top of the standard rate limits:

- **Grounded, anti-fabrication prompts.** The Q&A system prompt instructs the model to answer **only** from the supplied product metadata and to reply *"I don't see that detail in this product's listing"* when the answer isn't present — instead of inventing specs, dimensions, warranty, or compatibility claims. It also refuses questions unrelated to the product, so it can't be repurposed as a free general-purpose chatbot.
- **Strict input caps** before anything reaches OpenAI: question ≤ 240 chars, description ≤ 2000 chars, features ≤ 20 items. Bounds both prompt-injection surface and token cost.
- **Pre-computed facts, not model math.** Price advice hands the model already-computed statistics (min/max/median/percentile/trend); the model only phrases the recommendation, so it can't miscalculate the numbers.
- **Fails closed and quiet.** No key → `503` → widgets self-hide (see API.md §7). A vendor outage degrades to "feature absent," never a broken page or leaked error detail.

---

## 5. Cryptography inventory

Everywhere we sign, verify, or hash, and the key or secret that protects it.

| Algorithm | Where it's used | Key / secret | Rotation policy |
|---|---|---|---|
| **bcrypt (cost 10)** | Shopper / admin password hashes | Per-password salt | When the user changes their password |
| **bcrypt (cost 12)** | Developer password hashes; `client_secret_hash`; hashed OTPs on Auth | Per-record salt | On password change or credential rotation |
| **HS256** | `userToken`, `userRefreshToken`, `adminToken`, `adminRefreshToken` | `JWT_SECRET` (Users) | Manual; rotation invalidates every session |
| **HS256** | `authToken`, `authRefreshToken` | `JWT_SECRET` (Auth — separate env, different value) | Same |
| **HS256** | Provider access tokens (`productsauthorization`) | `JWT_PROVIDER_SECRET` (Auth) = `SECRET` (Amazon, Walmart) | Manual; rotation breaks every provider until they're all updated |
| **RS256** | Gateway assertion JWT to `/auth/token/refresh` | `GATEWAY_PRIVATE_KEY` (gateway only) + `GATEWAY_PUBLIC_KEY` (Auth only) | Generate a new pair, update both env vars, redeploy both |
| **HMAC-SHA via shared secret** (informal naming) | `x-internal-auth` header check | `INTERNAL_AUTH_SECRET` (everywhere) | Manual; rotation needs a coordinated update across all services |
| **CSRF tokens** | `csrfToken` cookie | `crypto.randomBytes(32).toString('hex')` per session | Per-session; refreshed when the session refreshes |
| **OTP codes** | `otp` doc, `authOtp` doc | `crypto.randomInt` for the value; bcrypt-hashed in Auth | Per-issuance, TTL 120s (Users) / 600s (Auth) |
| **Referral codes** | `checkoutIntent.referralCode` | `crypto.randomBytes(8).toString('hex').toUpperCase()` prefixed with `TT-` | Per-checkout, no rotation |

### Quick cheat sheet: which secrets are shared, which are distinct

| Secret | Same value on these services |
|---|---|
| `JWT_SECRET` | Users (only) — Auth has its own separate value |
| `JWT_PROVIDER_SECRET` | Auth, Amazon (`SECRET`), Walmart (`SECRET`) — **must match** |
| `INTERNAL_AUTH_SECRET` | All five backend services — **must match** |
| `GATEWAY_PRIVATE_KEY` / `GATEWAY_PUBLIC_KEY` | Private only on the gateway; public only on Auth |

If `INTERNAL_AUTH_SECRET` ever leaks, that's the single biggest blast radius. It gates every internal callback. To limit the blast radius, switch to per-pair secrets.

---

## 6. Known gaps and how we'd fix them

These are written down because pretending they don't exist is the actual security failure.

### G1 — Users password recovery enumerates valid emails

**Where:** `Users/Services/ForgotPasswordService.js` returns `404 User not found` for emails that don't exist.

**Impact:** an attacker can probe for valid emails by hitting `/recovery/forgotpassword` and watching the status code.

**Fix:** return `200` with the same body shape regardless of whether the email exists — same behavior as Auth's `Auth/server/Controllers/ForgotPasswordController.js`. Send the email only if the user exists; never tell the caller which.

**Status:** tracked, not yet implemented.

### G2 — Shopper / admin refresh tokens have no server-side invalidation

**Where:** `Users/Controllers/RefreshController.js` checks the refresh JWT's signature and type but doesn't consult any server-side state.

**Impact:** a stolen refresh token works for its full 7-day TTL. The user can't kill it from their device, and changing the password doesn't invalidate it.

**Fix:** add a `tokenVersion` (or `tv`) claim to shopper/admin refresh tokens. Store the current version on the `users` doc. Bump it on logout or password change. Mirror what the Auth server already does.

**Status:** tracked; design is clear; not yet implemented.

### G3 — `INTERNAL_AUTH_SECRET` is shared across all services

**Where:** the same env value lives on Gateway, Users, Auth, Amazon, and Walmart.

**Impact:** compromise of any single service's environment lets an attacker impersonate any internal endpoint.

**Fix:** per-pair secrets (e.g. `GATEWAY_TO_USERS_SECRET`, `AMZ_TO_AUTH_SECRET`) so each pair's secret only authorizes one direction.

**Status:** tracked. For a small system, this is over-engineering; revisit if blast radius matters.

### G4 — Per-instance caches limit revocation propagation under horizontal scaling

**Where:** gateway token cache (60s), gateway refresh lock, Auth replay cache, provider active-jti cache (30s), AI response cache.

**Impact:** with N instances, revocation can take up to `max(cache_TTL)` to fully propagate. Today the TTLs are short (≤60s), so the impact is small. A multi-instance Auth could in theory re-accept an already-seen assertion within the replay window.

**Fix:** move the caches to Redis. The `DELETE /internal/token-cache/:apiName` endpoint already exists, but it only clears one instance.

**Status:** documented. Acceptable at the current scale.

### G5 — `temp_clients` is deleted before the upstream call confirms

**Where:** `Users/Middlewares/authenticate.js:36` — `deleteOne` runs before the `axios.post` to Auth's `/authorize`.

**Impact:** a brief network issue during the upstream call leaves the user starting over (re-filling the AuthRequest form). It's a UX bug, not a security issue.

**Fix:** move `deleteOne` until after the upstream call succeeds. Wrap in try/catch and only delete on success.

**Status:** tracked.

### G6 — Global CSRF middleware interacts oddly with internal POSTs

**Where:** `Users/app.js:139` mounts `requireCsrf` globally, before any router.

**Impact:** internal POSTs that legitimately don't carry CSRF (e.g. Amazon → `/checkout/intent/.../complete` with `x-internal-auth`) currently only survive because the CSRF middleware short-circuits when there's no session cookie (`csrf.js:47`). That's a fragile contract — if a future change adds any session cookie to those calls, CSRF will start rejecting them.

**Fix:** mount `/internal/*` routes before global CSRF, with a strict `x-internal-auth` middleware in front. Or change CSRF to also short-circuit when `x-internal-auth` is present and valid.

**Status:** high-priority fix candidate.

### G7 — Admin bootstrap has a race window

**Where:** `Users/Routes/AdminRouter.js:30-39` — `allowFirstAdminOrAuthorized` opens `/admin/register` when zero admins exist.

**Impact:** between deployment and the legitimate admin registering, anyone who finds the endpoint can register as the first admin.

**Fix:** bootstrap-with-token. Generate a one-time bootstrap token at deploy time (e.g. as an env var), require it on the first registration, and allow open creation only after that. Once the first admin exists, the token is irrelevant.

**Status:** tracked. Today we mitigate it by registering the first admin immediately after deploy (the curl-bootstrap pattern in [`README.md` section 11](../README.md#11-running-locally)).

---

## 7. Incident response triggers

Conditions that should page an operator.

| Trigger | Severity | First action |
|---|---|---|
| `[gateway] ✗ Refresh threw for <provider>: ...` repeating | High | Check the `creds` row + Auth `/auth/token/refresh` logs; re-authorize the provider if `active_jti` has drifted |
| Sudden burst of 401s on `/admin/*` | High | Look at the admin session origins; consider bumping `JWT_SECRET` to force re-login |
| `/orders/place` returns success but Stripe shows no captured payment | Critical | Disable provider checkout endpoints; verify Stripe webhook + server-side amount recompute |
| Auth `cors_blocked` rate much higher than baseline | Medium | Confirm the new origin is intentional; update `CORS_ORIGINS` |
| `temp_clients` collection has stale documents older than 1h | Low | Re-create the TTL index on `created_at` |
| Any service logs `secretOrPrivateKey must be an asymmetric key` | High | Regenerate the keypair (`node genkeys.js`) and redeploy gateway + Auth |
| Mongo connection state drops to 0 for more than 30s | High | Check Atlas status + IP allowlist; restart the service |
| OpenAI / Brevo / Stripe vendor outage | Medium | Disable affected feature flags; watch vendor status pages |

Severity levels:
- **Critical** — money or unauthorized data access. Page immediately. Consider service shutdown.
- **High** — significant functionality broken or potential compromise. Page during business hours, urgent within 1 hour.
- **Medium** — degraded experience. Investigate the same day.
- **Low** — cleanup task. Schedule when you can.
