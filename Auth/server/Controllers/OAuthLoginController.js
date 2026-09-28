const bcrypt = require('bcryptjs');
const ClientModel = require('../Models/Client');
const CredentialModel = require('../Models/Credential');
const { loginLookupQuery } = require('../utils/loginIdentifier');

const isProd = () => process.env.NODE_ENV === 'production';

const allowedOrigins = () =>
    (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

const localhostRegex = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Defensive: the callbackUrl arrives via a hidden form field, so re-check
// it server-side before we redirect. Same allowlist as the GET page; an
// attacker can't slip in a malicious URL by tampering with the form.
const isAllowedCallback = (url) => {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && !isProd())) {
            return false;
        }
        const origin = `${parsed.protocol}//${parsed.host}`;
        if (allowedOrigins().includes(origin)) return true;
        if (!isProd() && localhostRegex.test(origin)) return true;
        return false;
    } catch {
        return false;
    }
};

// Robustly append a query param to a URL regardless of whether it already
// has a query string. Replaces the old `redirect_uri + "&..."` form, which
// produced malformed URLs like "/foo/bar&x=y" whenever redirect_uri had no
// "?" of its own.
const appendQuery = (urlStr, params) => {
    if (!urlStr) return '';
    const hasQuery = urlStr.includes('?');
    const sep = hasQuery ? '&' : '?';
    const qs = Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    return `${urlStr}${sep}${qs}`;
};


const loginClients = async (req, res) => {

    try {

        const { username, password, callbackUrl: bodyCallbackUrl } = req.body;
        const renderLogin = (status, data) =>
            res.status(status).render('login', {
                isAuthorizationFlow: true,
                ...data
            });

        if (typeof username !== 'string' || typeof password !== 'string') {
            return renderLogin(400, { error: 'Invalid input', callbackUrl: bodyCallbackUrl || null });
        }

        // `username` may also be the account email — see loginIdentifier.js.
        const client = await ClientModel.findOne(loginLookupQuery(username));
        if (!client) {
            return renderLogin(403, { error: 'Invalid credentials', callbackUrl: bodyCallbackUrl || null });
        }
        // Google-only accounts have no local password hash. Treat as invalid
        // creds — don't reveal that the account uses Google sign-in.
        if (!client.password) {
            return renderLogin(403, { error: 'Invalid credentials', callbackUrl: bodyCallbackUrl || null });
        }

        const ok = await bcrypt.compare(password, client.password);
        if (!ok) {
            return renderLogin(403, { error: 'Invalid credentials', callbackUrl: bodyCallbackUrl || null });
        }

        const clientId = req.cookies && req.cookies.client_id;
        if (typeof clientId !== 'string' || clientId.length === 0) {
            return renderLogin(400, { error: 'Missing client_id', callbackUrl: bodyCallbackUrl || null });
        }

        const credential = await CredentialModel.findOne({ client_id: clientId });
        if (!credential) {
            return renderLogin(404, { error: 'Unknown client_id', callbackUrl: bodyCallbackUrl || null });
        }

        // Prefer the callback URL the calling app (TrendyTreasures admin)
        // sent through the hidden form field, falling back to whatever was
        // registered with the credential. The hidden field is re-validated
        // against the allowlist here so tampering with the form can't
        // redirect the user to an attacker-controlled origin.
        let baseUrl = null;
        if (typeof bodyCallbackUrl === 'string' && bodyCallbackUrl.length > 0 && isAllowedCallback(bodyCallbackUrl)) {
            baseUrl = bodyCallbackUrl;
        } else if (credential.redirect_uri && isAllowedCallback(credential.redirect_uri)) {
            baseUrl = credential.redirect_uri;
        }

        if (!baseUrl) {
            return renderLogin(400, { error: 'No callback URL configured', callbackUrl: null });
        }

        // Always the stored username, never what was typed: /auth/authorize
        // looks the owner up by exact username, so an email (or stray
        // whitespace) here would pass sign-in and then fail authorization.
        const callbackUrl = appendQuery(baseUrl, {
            username: client.username,
            client_id: clientId
        });

        return res.redirect(callbackUrl);

    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('OAuthLogin error:', err.message);
        res.status(500).render('login', {
            isAuthorizationFlow: true,
            error: 'Internal server error',
            callbackUrl: null
        });
    }
};

module.exports = loginClients;
