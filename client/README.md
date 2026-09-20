# Trendy Treasures Storefront

React 18 storefront/admin SPA for Trendy Treasures.

## Production

- Frontend: `https://ecommerce-test-qvvv.vercel.app`
- API Gateway: `https://trendy-gateway-ppa6nvipwa-pd.a.run.app`
- Auth server: `https://trendy-auth-ppa6nvipwa-pd.a.run.app`
- Amazon checkout: `https://trendy-amazon-ppa6nvipwa-pd.a.run.app/checkout`
- Walmart checkout: `https://trendy-walmart-ppa6nvipwa-pd.a.run.app/checkout`

The browser sends normal storefront API traffic through the gateway. Provider access JWTs remain server-side and are injected by the gateway.

## Environment variables

Local development:

```text
REACT_APP_API_URL=http://localhost:7000
REACT_APP_AUTH_URL=http://localhost:5000
REACT_APP_CLIENT_URL=http://localhost:3001
REACT_APP_AMAZON_CHECKOUT_URL=http://localhost:8000/checkout
REACT_APP_WALMART_CHECKOUT_URL=http://localhost:8001/checkout
```

Production values are configured in Vercel. Because Create React App environment variables are build-time values, changing them requires a new Vercel deployment.

## Local development

```powershell
npm install
npm start
```

The storefront runs on `http://localhost:3001`.

## API helper

Use the shared `apiFetch` helper instead of calling `fetch` directly for application API requests. It handles credentials, CSRF token propagation, session refresh/retry behavior, and request conventions expected by the backend.

## Build

```powershell
npm run build
```

The optimized bundle is written to `build/`.

For backend architecture and deployment details, see the repository root [`README.md`](../README.md) and [`CLOUD_RUN_DEPLOYMENT.md`](../CLOUD_RUN_DEPLOYMENT.md).
