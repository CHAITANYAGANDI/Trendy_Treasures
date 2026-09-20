# Deploying Trendy Treasures to Google Cloud Run

Specific to this repository. The storefront stays on Vercel and MongoDB stays
on Atlas; only the five backend services move.

Replace every `PROJECT_ID`, `REGION` and `*-xxxxx.run.app` placeholder with
your own values. No secret values appear in this document — and none should
be added to it.

---

## 1. Architecture

```
                    Vercel  (client/ — React storefront)
                       |
                       v
            Cloud Run  API Gateway   (APIGateway/)
                       |
        +--------------+--------------+--------------+
        |              |              |              |
        v              v              v              v
   Cloud Run      Cloud Run      Cloud Run      Cloud Run
     Users          Auth          Amazon         Walmart
   (Users/)     (Auth/server/)   (Amazon/)     (Walmart/)
        |              |              |              |
        +--------------+--------------+--------------+
                       |
                       v
                 MongoDB Atlas
```

Two things are not a straight line through the gateway, and both must keep
working:

- **Auth Shield** is a separate frontend that calls the Auth service on its
  **public** URL. Auth must stay publicly reachable. Do not lock it down to
  gateway-only access.
- **Amazon and Walmart serve their own branded checkout pages** to browsers
  (`Amazon/public/checkout.html`, `Walmart/templates/`). They are not purely
  internal services, so their `CORS_ORIGINS` and `TRENDY_TREASURES_URL` both
  matter.

This first deployment uses `--allow-unauthenticated` on every service.
Application-level auth still protects everything sensitive: the RS256 gateway
assertion on `/auth/token/refresh`, `INTERNAL_AUTH_SECRET` on internal
routes, the provider JWT on product routes, CSRF on state-changing browser
routes, and per-service rate limiting. Cloud Run IAM hardening is a separate,
later task.

---

## 2. Before the first deploy

### 2.1 One-time project setup

```bash
gcloud auth login
gcloud config set project PROJECT_ID
gcloud config set run/region REGION          # e.g. us-central1

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

### 2.2 MongoDB Atlas network access

Cloud Run has no stable outbound IP by default, so Atlas IP allow-listing
will not work as it may have on Render. Either:

- allow `0.0.0.0/0` in Atlas (acceptable only because the connection string
  itself is the credential), **or**
- attach a Serverless VPC connector with Cloud NAT and allow-list that NAT IP
  (better, but more setup and not required for this first cutover).

### 2.3 Generate nothing new

Reuse the existing secrets. In particular **do not** regenerate the gateway
keypair — see §5 for the relationships that must hold.

---

## 3. Deployment order

Services must come up before the things that point at them, and the gateway
needs all four upstream URLs. Deploy in this order:

| # | Step | Why this order |
|---|------|----------------|
| 1 | **Auth** (`Auth/server`) | Nothing else can mint provider tokens without it |
| 2 | **Users** (`Users`) | Needs `AUTH_SERVER_URL` from step 1 |
| 3 | **Amazon** (`Amazon`) | Needs `AUTH_SERVER_URL` for jti introspection |
| 4 | **Walmart** (`Walmart`) | Same |
| 5 | **API Gateway** (`APIGateway`) | Needs all four URLs above |
| 6 | **Backfill inter-service URLs** | Users/Amazon/Walmart need the gateway URL, which only exists after step 5 |
| 7 | **Update Vercel env vars** | Point the storefront at the new gateway |
| 8 | **Update Google OAuth redirect URIs** | Two separate OAuth clients — see §7 |
| 9 | **Production verification** | §8 |

Step 6 exists because the dependency is circular: the gateway needs the
service URLs and three services need the gateway URL. Deploy, then update.

---

## 4. Deploy commands

Every service deploys from source; Cloud Build detects Node from
`package.json` and Python from `requirements.txt`. Walmart has a `Dockerfile`,
which Cloud Build uses in preference to the Python buildpack.

`PORT` is injected by Cloud Run and **must not** be set in `--set-env-vars`.
All five services already read `process.env.PORT` / `os.environ['PORT']` and
bind all interfaces, so no code change is needed.

### 4.1 Auth

```bash
gcloud run deploy trendy-auth \
  --source ./Auth/server \
  --region REGION \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,DEPLOYMENT_PLATFORM=cloud-run \
  --set-env-vars MONGO_CONN=...,JWT_SECRET=...,JWT_PROVIDER_SECRET=... \
  --set-env-vars INTERNAL_AUTH_SECRET=...,TRUSTED_ISSUERS=apigateway \
  --set-env-vars CORS_ORIGINS=...,AUTH_CLIENT_URL=... \
  --set-env-vars BREVO_API_KEY=...,MAIL_FROM=... \
  --set-env-vars GOOGLE_CLIENT_ID=...,GOOGLE_CLIENT_SECRET=...,GOOGLE_REDIRECT_URI=...
```

`GATEWAY_PUBLIC_KEY` is a PEM containing newlines. `--set-env-vars` cannot
carry those safely; use Secret Manager (§6) or the `\n`-escaped single-line
form the code already supports (`parseKey` in
`Auth/server/Controllers/TokenRefreshController.js` converts `\n` back).

Record the URL it prints — that is `AUTH_SERVER_URL` for everything else.

### 4.2 Users

```bash
gcloud run deploy trendy-users \
  --source ./Users \
  --region REGION \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,DEPLOYMENT_PLATFORM=cloud-run \
  --set-env-vars MONGO_CONN=...,JWT_SECRET=...,INTERNAL_AUTH_SECRET=... \
  --set-env-vars AUTH_SERVER_URL=https://trendy-auth-xxxxx.run.app \
  --set-env-vars CLIENT_URL=https://your-storefront.vercel.app \
  --set-env-vars CORS_ORIGINS=... \
  --set-env-vars BREVO_API_KEY=...,MAIL_FROM=... \
  --set-env-vars OPENAI_API_KEY=...
```

`API_GATEWAY_URL` and `GOOGLE_REDIRECT_URI` are filled in at step 6.

### 4.3 Amazon

```bash
gcloud run deploy trendy-amazon \
  --source ./Amazon \
  --region REGION \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,DEPLOYMENT_PLATFORM=cloud-run \
  --set-env-vars MONGO_CONN=...,SECRET=...,INTERNAL_AUTH_SECRET=... \
  --set-env-vars AUTH_SERVER_URL=https://trendy-auth-xxxxx.run.app \
  --set-env-vars TRENDY_TREASURES_URL=https://your-storefront.vercel.app \
  --set-env-vars CORS_ORIGINS=... \
  --set-env-vars STRIPE_SECRET_KEY=...,STRIPE_PUBLISHABLE_KEY=...
```

### 4.4 Walmart

```bash
gcloud run deploy trendy-walmart \
  --source ./Walmart \
  --region REGION \
  --allow-unauthenticated \
  --set-env-vars FLASK_ENV=production,DEPLOYMENT_PLATFORM=cloud-run \
  --set-env-vars MONGO_CONN=...,SECRET=...,INTERNAL_AUTH_SECRET=... \
  --set-env-vars AUTH_SERVER_URL=https://trendy-auth-xxxxx.run.app \
  --set-env-vars TRENDY_TREASURES_URL=https://your-storefront.vercel.app \
  --set-env-vars CORS_ORIGINS=... \
  --set-env-vars STRIPE_SECRET_KEY=...,STRIPE_PUBLISHABLE_KEY=...
```

**Gunicorn entrypoint.** `Walmart/Dockerfile` already ends with:

```dockerfile
CMD gunicorn --bind 0.0.0.0:${PORT:-8001} --workers 1 --threads 8 --timeout 60 app:app
```

That is exactly what Cloud Run needs — it binds `0.0.0.0` and honours the
injected `PORT`. **Keep `--workers 1`.** Flask-Limiter here uses in-process
`memory://` storage, so each additional worker would get its own private
counter and the effective rate limit would silently become
`workers × limit`. Concurrency comes from threads. If you ever need more
throughput, raise Cloud Run's `--concurrency` or instance count rather than
worker count — and note that multiple *instances* have the same problem, so
scaling out past one instance means moving Flask-Limiter (and the Node
services' `MemoryStore`) to a shared backend. For this cutover, set
`--max-instances 1` if you want the configured limits to hold exactly.

### 4.5 API Gateway

```bash
gcloud run deploy trendy-gateway \
  --source ./APIGateway \
  --region REGION \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,DEPLOYMENT_PLATFORM=cloud-run \
  --set-env-vars MONGO_CONN=...,INTERNAL_AUTH_SECRET=...,GATEWAY_ISSUER=apigateway \
  --set-env-vars USERS_SERVICE_URL=https://trendy-users-xxxxx.run.app \
  --set-env-vars AMAZON_SERVICE_URL=https://trendy-amazon-xxxxx.run.app \
  --set-env-vars WALMART_SERVICE_URL=https://trendy-walmart-xxxxx.run.app \
  --set-env-vars AUTH_SERVER_URL=https://trendy-auth-xxxxx.run.app \
  --set-env-vars CLIENT_URL=https://your-storefront.vercel.app \
  --set-env-vars CORS_ORIGINS=https://your-storefront.vercel.app,https://trendy-amazon-xxxxx.run.app,https://trendy-walmart-xxxxx.run.app
```

`GATEWAY_PRIVATE_KEY` is a PEM — use Secret Manager (§6).

### 4.6 Step 6 — backfill

```bash
GATEWAY_URL=https://trendy-gateway-xxxxx.run.app

gcloud run services update trendy-users --region REGION \
  --update-env-vars API_GATEWAY_URL=$GATEWAY_URL,GOOGLE_REDIRECT_URI=$GATEWAY_URL/api/v1/user/auth/google/callback

gcloud run services update trendy-amazon  --region REGION --update-env-vars TT_GATEWAY_URL=$GATEWAY_URL
gcloud run services update trendy-walmart --region REGION --update-env-vars TT_GATEWAY_URL=$GATEWAY_URL
```

### 4.7 Step 7 — Vercel

Point the storefront at the new gateway and redeploy it. The variable is
whichever `REACT_APP_*` gateway URL `client/src/utils.js` reads (`GATEWAY_URL`
there). Then add the Vercel origin to `CORS_ORIGINS` on the gateway, Users,
Amazon and Walmart if it is not already present.

---

## 5. Environment variables by service

Do not print or paste secret values into this file.

### Shared — identical value everywhere it appears

| Variable | Services | Rule |
|---|---|---|
| `INTERNAL_AUTH_SECRET` | gateway, Users, Auth, Amazon, Walmart | **Must match byte-for-byte in all five.** Gates internal routes, and is what lets downstream services trust the gateway's `x-real-client-ip`. A mismatch does not fail loudly — it silently collapses every shopper into one rate-limit bucket |
| `MONGO_CONN` | all five | Same Atlas cluster. Gateway and Users must point at the **same database** — the gateway reads the `creds` collection that Users' admin authorization flow writes |
| `CORS_ORIGINS` | gateway, Users, Auth, Amazon, Walmart | Comma-separated exact origins. Never `*` — credentials are enabled |
| `NODE_ENV=production` | gateway, Users, Auth, Amazon | Enables secure cookies and strict env validation |
| `FLASK_ENV=production` | Walmart | Same role for the Flask service |
| `DEPLOYMENT_PLATFORM=cloud-run` | all five | Selects the client-IP/proxy-trust policy. See §9 |

### Three relationships that must hold

```
Auth JWT_PROVIDER_SECRET  ==  Amazon SECRET  ==  Walmart SECRET
```
Auth signs provider JWTs with `JWT_PROVIDER_SECRET`; Amazon and Walmart
verify them with `SECRET`. The variable names differ, the value must not.
A mismatch shows up as `403 {"message":"Token signature verification failed"}`.

```
INTERNAL_AUTH_SECRET  ==  the same value in all five services
```

```
Gateway GATEWAY_PRIVATE_KEY  <->  Auth GATEWAY_PUBLIC_KEY
```
One RS256 keypair. The gateway signs a short-lived assertion with the private
half; Auth verifies it with the public half. Only the gateway ever holds the
private key. A mismatch shows up as
`401 {"message":"Assertion invalid: ..."}` on `/auth/token/refresh`.
Generate with `genkeys.js` **only** if you are rotating both halves together.

### Gateway-only

`USERS_SERVICE_URL`, `AMAZON_SERVICE_URL`, `WALMART_SERVICE_URL`,
`AUTH_SERVER_URL`, `CLIENT_URL`, `GATEWAY_PRIVATE_KEY`, `GATEWAY_ISSUER`,
`RATE_LIMIT_PER_MIN`, `AUTH_RATE_LIMIT_PER_15M`, `CSRF_RATE_LIMIT_PER_MIN`,
`SNAPSHOT_STALE_MS`, `TOKEN_REFRESH_AHEAD_SECONDS`, `REFRESH_MAX_ATTEMPTS`,
`REFRESH_REQUEST_TIMEOUT_MS`, `REFRESH_MAX_RETRY_DELAY_MS`,
`REFRESH_COOLDOWN_MS`, `TOKEN_CACHE_TTL_MS`

### Users-only

`JWT_SECRET`, `CLIENT_URL`, `AUTH_SERVER_URL`, `API_GATEWAY_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
`BREVO_API_KEY`, `MAIL_FROM`, `OPENAI_API_KEY`, `OPENAI_MODEL`,
`RATE_LIMIT_PER_MIN`, `AUTH_RATE_LIMIT_PER_15M`

### Auth-only

`JWT_SECRET`, `JWT_PROVIDER_SECRET`, `GATEWAY_PUBLIC_KEY`, `TRUSTED_ISSUERS`,
`CLIENT_TOKEN_TTL`, `AUTH_CLIENT_URL`, `FORM_ACTION_ORIGINS`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
`BREVO_API_KEY`, `MAIL_FROM`, `INTERNAL_TOKEN_RATE_LIMIT_PER_MIN`

`JWT_SECRET` on Auth is a **different** value from `JWT_SECRET` on Users —
they are separate trust domains (Auth Shield clients vs storefront shoppers).
Do not unify them.

### Amazon-only / Walmart-only

Same shape for both: `SECRET`, `AUTH_SERVER_URL`, `TT_GATEWAY_URL`,
`TRENDY_TREASURES_URL`, `AUTH_INTROSPECT_CACHE_TTL_MS`, `RATE_LIMIT_PER_MIN`,
`PAYMENTS_RATE_LIMIT_PER_MIN`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`.

Each owns its own database, so their `MONGO_CONN` values point at different
databases from the storefront's.

---

## 6. PEM keys and secrets

`GATEWAY_PRIVATE_KEY` and `GATEWAY_PUBLIC_KEY` contain newlines, which
`--set-env-vars` mangles. Use Secret Manager:

```bash
gcloud secrets create gateway-private-key --data-file=./private.pem
gcloud secrets create gateway-public-key  --data-file=./public.pem

gcloud run services update trendy-gateway --region REGION \
  --set-secrets GATEWAY_PRIVATE_KEY=gateway-private-key:latest
gcloud run services update trendy-auth --region REGION \
  --set-secrets GATEWAY_PUBLIC_KEY=gateway-public-key:latest
```

Grant the runtime service account `roles/secretmanager.secretAccessor`.
The same approach suits `MONGO_CONN`, `JWT_SECRET`, `JWT_PROVIDER_SECRET`,
`INTERNAL_AUTH_SECRET` and the Stripe/Brevo/OpenAI keys — `--set-env-vars`
puts them in plaintext in the service description.

---

## 7. Google OAuth

There are **two separate OAuth clients** and they are easy to mix up:

| Client | Callback goes to | New redirect URI |
|---|---|---|
| Storefront | the **gateway**, not Users | `https://trendy-gateway-xxxxx.run.app/api/v1/user/auth/google/callback` |
| Auth Shield | the **Auth service** directly | `https://trendy-auth-xxxxx.run.app/auth/google/callback` |

The storefront's callback must route through the gateway. If it points at the
Users service directly, the OAuth state cookie and the session cookies land
on a hostname the SPA never sends cookies to, and login fails in a way that
looks like a cookie bug.

**Add the new URIs before cutting over, and remove the old Render ones only
afterwards.** Google allows multiple redirect URIs per client, so both
platforms can work simultaneously during the migration. Mismatches surface as
`redirect_uri_mismatch`.

---

## 8. Production verification

Run these in order; each one isolates a different failure.

1. **Health.** `curl https://trendy-gateway-xxxxx.run.app/health` → `{"status":"ok"}`
   with the four upstream URLs echoed back. Confirms the gateway booted and
   reached Mongo (`mongoState: 1`).

2. **Identity policy.** In each service's Cloud Run logs, find the startup
   line: `client-identity: platform=cloud-run trustProxy=1 edgeHeader=none`.
   If any service says `platform=local` or `edgeHeader=cf-connecting-ip`,
   its `DEPLOYMENT_PLATFORM` is wrong — fix before going further.

3. **Per-shopper rate limiting.** Make a few requests and confirm
   `RateLimit-Remaining` decrements. From a second network (phone hotspot),
   confirm it has its own budget. If both share one counter, the
   `x-real-client-ip` chain is broken — check `INTERNAL_AUTH_SECRET` matches
   everywhere.

4. **Provider tokens.** Load the storefront home page. Products should load.
   Gateway logs should show at most one `refresh attempt 1/3` per provider,
   then `refresh succeeded for Amazon_Products; expires_at=...`. No shopper
   should ever see `403 Token has expired`.

5. **The 429 label.** If any 429 appears, check `x-ratelimit-source`:
   `upstream-app` means a service's own limiter fired; `upstream-edge` means
   infrastructure in front of a service answered, which no app-side config
   will fix.

6. **Browser auth.** Storefront signup (two-step OTP), login, Google login,
   logout. Then Auth Shield login on its own public URL — it must still work.

7. **CSRF.** A state-changing call without `x-csrf-token` must still be
   rejected with 403.

8. **Checkout.** "Continue on Amazon" and "Continue on Walmart" should load
   the branded page, and its back-link should return to the Vercel
   storefront (verifies `TRENDY_TREASURES_URL`).

---

## 9. What changed in the code for this migration

Client-IP resolution and proxy trust were Render-specific and are now
platform-selected. The order, on every service:

1. `x-real-client-ip` — **only** when `x-internal-auth` matches
   `INTERNAL_AUTH_SECRET` under a constant-time comparison. This is our own
   gateway, and it is what keeps per-shopper buckets working through the
   proxy.
2. A platform edge header — **only** where the platform declares one.
   `CF-Connecting-IP` is trusted on `render` and **not** on `cloud-run`,
   because nothing on Cloud Run strips it: trusting it there would let any
   caller mint a fresh rate-limit bucket per request by setting a header.
3. `req.ip`, from an explicit trust-proxy hop count (`1` on Cloud Run, `2` on
   Render, `loopback` locally).

`DEPLOYMENT_PLATFORM` selects the preset; `TRUST_PROXY` overrides the hop
count for an unlisted topology. `TRUST_PROXY=true` is refused and logged,
because it would make X-Forwarded-For spoofing trivial.

**One hop count to re-check.** `cloud-run` assumes exactly one appending
proxy — the Cloud Run front end — which is the case when traffic arrives
directly at a `*.run.app` URL. Each proxy appends the address it received
from, so with one hop the last `X-Forwarded-For` entry is the real caller,
and a caller prepending forged entries cannot displace it. If you later put
an **external HTTP(S) Load Balancer, Cloud Armor or a CDN** in front of a
service, that adds a hop and you must set `TRUST_PROXY=2` on that service.
Verify after the first deploy with step 3 of §8: if two different networks
share one rate-limit counter, the hop count is too low; if a caller can
change their own identity by sending `X-Forwarded-For`, it is too high.

The production default when `DEPLOYMENT_PLATFORM` is unset is `cloud-run` —
the conservative choice, since it trusts no caller-supplied header. **This
means the existing Render services need `DEPLOYMENT_PLATFORM=render` set
explicitly**, or their buckets get coarser than before. Set that first if
Render is still serving traffic.

Unchanged by this migration: the provider-token lifecycle (proactive refresh,
single-flight, retry/backoff/cooldown, reactive refresh after rejection),
RS256 gateway assertions, `active_jti` introspection, CSRF, CORS policy, and
the three separate gateway rate-limit budgets.
