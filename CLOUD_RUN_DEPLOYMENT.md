# Trendy Treasures — Production Deployment on Google Cloud Run

This is the canonical production deployment/runbook for Trendy Treasures.

The two React SPAs stay on **Vercel**. All five backend services run on **Google Cloud Run** in Toronto (`northamerica-northeast2`). MongoDB stays on **MongoDB Atlas**. Runtime secrets are stored in **Google Secret Manager**. Source deployments build with **Cloud Build** and store images in **Artifact Registry**.

## 1. Production topology

| Component | Platform | Production URL |
|---|---|---|
| Storefront (`client/`) | Vercel | `https://ecommerce-test-qvvv.vercel.app` |
| AuthShield (`Auth/client/`) | Vercel | `https://ecommerce-test-lemon-xi.vercel.app` |
| API Gateway (`APIGateway/`) | Cloud Run | `https://trendy-gateway-ppa6nvipwa-pd.a.run.app` |
| Users (`Users/`) | Cloud Run | `https://trendy-users-ppa6nvipwa-pd.a.run.app` |
| Auth (`Auth/server/`) | Cloud Run | `https://trendy-auth-ppa6nvipwa-pd.a.run.app` |
| Amazon (`Amazon/`) | Cloud Run | `https://trendy-amazon-ppa6nvipwa-pd.a.run.app` |
| Walmart (`Walmart/`) | Cloud Run | `https://trendy-walmart-ppa6nvipwa-pd.a.run.app` |

Google Cloud project: `trendy-treasures-prod-csg-2026`

Region: `northamerica-northeast2`

The gateway is the storefront's public API entry point. Auth is also public because AuthShield calls it directly. Amazon and Walmart stay public because they host the branded checkout pages. Users is currently public as well, with application-level authentication/rate limiting retained as defense in depth.

## 2. Cloud Run services and runtime identities

| Service | Runtime service account |
|---|---|
| `trendy-gateway` | `trendy-gateway-runtime@trendy-treasures-prod-csg-2026.iam.gserviceaccount.com` |
| `trendy-users` | `trendy-users-runtime@trendy-treasures-prod-csg-2026.iam.gserviceaccount.com` |
| `trendy-auth` | `trendy-auth-runtime@trendy-treasures-prod-csg-2026.iam.gserviceaccount.com` |
| `trendy-amazon` | `trendy-amazon-runtime@trendy-treasures-prod-csg-2026.iam.gserviceaccount.com` |
| `trendy-walmart` | `trendy-walmart-runtime@trendy-treasures-prod-csg-2026.iam.gserviceaccount.com` |

Each runtime identity should have Secret Manager access only to the secrets required by that service.

## 3. Secret Manager layout

| Secret | Used by |
|---|---|
| `auth-mongo-conn` | Auth |
| `auth-jwt-secret` | Auth |
| `jwt-provider-secret` | Auth, Amazon, Walmart |
| `internal-auth-secret` | Gateway, Users, Auth, Amazon, Walmart |
| `gateway-public-key` | Auth |
| `gateway-private-key` | Gateway |
| `brevo-api-key` | Auth, Users |
| `users-mongo-conn` | Users, Gateway |
| `users-jwt-secret` | Users |
| `users-openai-api-key` | Users |
| `users-google-client-secret` | Users |
| `auth-google-client-secret` | Auth |
| `amazon-mongo-conn` | Amazon |
| `amazon-stripe-secret-key` | Amazon |
| `walmart-mongo-conn` | Walmart |
| `walmart-stripe-secret-key` | Walmart |

Important trust relationships:

- Auth `JWT_PROVIDER_SECRET` = Amazon `SECRET` = Walmart `SECRET`.
- `INTERNAL_AUTH_SECRET` is the same across all five backends.
- Gateway `GATEWAY_PRIVATE_KEY` must match Auth `GATEWAY_PUBLIC_KEY`.
- Users and Gateway intentionally use the same storefront MongoDB database.
- Users' `JWT_SECRET` and Auth's `JWT_SECRET` are different secrets.
- Do not put secret values in `--set-env-vars`; use `--set-secrets`.

## 4. Platform settings

Every Cloud Run backend uses `DEPLOYMENT_PLATFORM=cloud-run`.

Cloud Run injects `PORT`; never set `PORT` manually in the deployed environment.

Current deployment uses `--allow-unauthenticated` and `--max-instances 1`.

The one-instance cap is deliberate while these mechanisms are in memory:

- Gateway provider-token cache and single-flight refresh state
- Auth assertion replay protection
- Per-service rate-limit counters
- Amazon/Walmart active-JTI caches

Before increasing the instance count, move shared state/counters to Redis or another centralized store where exact global semantics matter.

## 5. Service wiring

```text
Storefront (Vercel)
        |
        v
API Gateway (Cloud Run)
   |        |         |
   v        v         v
 Users    Amazon    Walmart
   |        |         |
   +--------+---------+
            |
            v
       Auth server

AuthShield (Vercel) ---> Auth server
GitHub Actions -------> API Gateway
```

Required production URL relationships:

- Gateway `USERS_SERVICE_URL` → `trendy-users`
- Gateway `AMAZON_SERVICE_URL` → `trendy-amazon`
- Gateway `WALMART_SERVICE_URL` → `trendy-walmart`
- Gateway `AUTH_SERVER_URL` → `trendy-auth`
- Users `AUTH_SERVER_URL` → `trendy-auth`
- Users `API_GATEWAY_URL` → `trendy-gateway`
- Amazon/Walmart `AUTH_SERVER_URL` → `trendy-auth`
- Amazon/Walmart `TT_GATEWAY_URL` → `trendy-gateway`

Production CORS allowlists contain the Vercel and Cloud Run origins used by the current system. Render is not part of the production runtime path.

## 6. Source deployment

All backends have a Dockerfile and deploy from their service directory.

```powershell
$PROJECT_ID = "trendy-treasures-prod-csg-2026"
$REGION = "northamerica-northeast2"
gcloud config set project $PROJECT_ID
gcloud config set run/region $REGION
```

For a normal source change, deploy the affected service with `gcloud run deploy <service> --source <directory>` and preserve its runtime service account, env vars, secret mappings, public access setting, and max-instance setting.

For configuration-only changes, use `gcloud run services update` with `--update-env-vars` or `--update-secrets`. Configuration-only updates create a new revision without rebuilding source.

## 7. Google OAuth

Storefront OAuth callback:

```text
https://trendy-gateway-ppa6nvipwa-pd.a.run.app/api/v1/user/auth/google/callback
```

AuthShield OAuth callback:

```text
https://trendy-auth-ppa6nvipwa-pd.a.run.app/auth/google/callback
```

The storefront callback must terminate on the gateway, not Users directly, so the OAuth state/session cookie round-trip stays on the same API origin used by the SPA.

Google client secrets are stored in Secret Manager. Client IDs and redirect URIs are regular Cloud Run environment variables.

## 8. Vercel production configuration

Storefront:

```text
REACT_APP_API_URL=https://trendy-gateway-ppa6nvipwa-pd.a.run.app
REACT_APP_AUTH_URL=https://trendy-auth-ppa6nvipwa-pd.a.run.app
REACT_APP_CLIENT_URL=https://ecommerce-test-qvvv.vercel.app
REACT_APP_AMAZON_CHECKOUT_URL=https://trendy-amazon-ppa6nvipwa-pd.a.run.app/checkout
REACT_APP_WALMART_CHECKOUT_URL=https://trendy-walmart-ppa6nvipwa-pd.a.run.app/checkout
```

AuthShield:

```text
REACT_APP_AUTH_URL=https://trendy-auth-ppa6nvipwa-pd.a.run.app/auth
```

React environment variables are build-time values, so changing them requires a new Vercel deployment.

## 9. MongoDB Atlas

There are separate Atlas projects/databases for storefront, Auth, Amazon, and Walmart. Cloud Run does not provide a fixed outbound IP by default.

The current deployment uses public Atlas connectivity protected by MongoDB credentials/TLS. A stronger production hardening step is to route Cloud Run egress through a VPC connector + Cloud NAT static IP and restrict Atlas Network Access to that IP instead of broad public access.

## 10. Scheduled price snapshots

`.github/workflows/snapshot-tracked-prices.yml` runs every six hours and calls `POST /internal/snapshot-tracked` on the Cloud Run gateway.

Repository secrets:

- `GATEWAY_URL` — `https://trendy-gateway-ppa6nvipwa-pd.a.run.app`
- `INTERNAL_AUTH_SECRET` — same shared secret used by the gateway

A manual workflow run should finish successfully after any gateway URL or authentication change.

## 11. Production verification

```powershell
$AUTH_URL = "https://trendy-auth-ppa6nvipwa-pd.a.run.app"
$USERS_URL = "https://trendy-users-ppa6nvipwa-pd.a.run.app"
$AMAZON_URL = "https://trendy-amazon-ppa6nvipwa-pd.a.run.app"
$WALMART_URL = "https://trendy-walmart-ppa6nvipwa-pd.a.run.app"
$GATEWAY_URL = "https://trendy-gateway-ppa6nvipwa-pd.a.run.app"

Invoke-RestMethod "$AUTH_URL/health"
Invoke-RestMethod "$AUTH_URL/ready"
Invoke-RestMethod "$USERS_URL/health"
Invoke-RestMethod "$AMAZON_URL/health"
Invoke-RestMethod "$WALMART_URL/health"
Invoke-RestMethod "$GATEWAY_URL/health"
```

Expected database state:

- Auth `/ready` → `mongoState: 1`
- Users → `mongoState: 1`
- Amazon → `mongoState: 1`
- Walmart → `mongo: true`
- Gateway → `mongoState: 1`

Cross-service smoke tests:

```powershell
Invoke-RestMethod "$GATEWAY_URL/api/v1/user/csrf-token" | Out-Null
Invoke-RestMethod "$GATEWAY_URL/api/v1/amazon/products/get" | Out-Null
Invoke-RestMethod "$GATEWAY_URL/api/v1/walmart/products/get" | Out-Null
```

Then test storefront login, Google OAuth, product loading, cart/checkout, AuthShield login, provider authorization, and session refresh.

## 12. Operational checks

```powershell
gcloud run services list --region northamerica-northeast2
gcloud run services logs read trendy-gateway --region northamerica-northeast2 --limit=100
```

To verify retired Render URLs are not present in runtime configuration, inspect each Cloud Run service's environment variables and search for `onrender.com`.

Repository comments/tests may still mention Render because the code intentionally retains a `DEPLOYMENT_PLATFORM=render` compatibility preset. Those references are portability documentation, not production dependencies.

## 13. Next hardening steps

1. Redis-backed shared rate-limit/cache/replay state, then increase Cloud Run instance counts.
2. IAM-authenticated service-to-service calls and/or private ingress for services that do not need direct browser access.
3. Static Cloud Run egress with Cloud NAT and a restricted Atlas IP allowlist.
4. External HTTPS load balancer + Cloud Armor if stronger edge controls are needed.
5. Budget alerts and centralized log-based alerts for auth/payment/security events.
