# AuthShield Client

React 18 developer-facing SPA for the Trendy Treasures Auth service. Developers use it to register, sign in, and create, rotate, or delete API credentials.

## Production

- Frontend: `https://ecommerce-test-lemon-xi.vercel.app`
- Auth API base: `https://trendy-auth-ppa6nvipwa-pd.a.run.app/auth`

## Environment variable

Local development:

```text
REACT_APP_AUTH_URL=http://localhost:5000/auth
```

Production in Vercel:

```text
REACT_APP_AUTH_URL=https://trendy-auth-ppa6nvipwa-pd.a.run.app/auth
```

React environment variables are build-time values, so changing the production API URL requires a new Vercel deployment.

## Local development

```powershell
npm install
npm start
```

The AuthShield SPA runs on `http://localhost:3002`.

## Build

```powershell
npm run build
```

The optimized bundle is written to `build/`.

AuthShield talks directly to the Auth Cloud Run service rather than through the storefront API Gateway. Google OAuth for AuthShield therefore uses:

```text
https://trendy-auth-ppa6nvipwa-pd.a.run.app/auth/google/callback
```

For the complete authentication architecture, see [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) and [`../docs/SECURITY.md`](../docs/SECURITY.md).
