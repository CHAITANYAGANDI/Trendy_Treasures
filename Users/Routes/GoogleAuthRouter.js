const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
    getGoogleAuthURL,
    getGoogleUser,
    isGoogleConfigured
} = require('../Middlewares/googleAuth');
const UserModel = require('../Models/User');
const { authCookieOptions, clearCookieOptions } = require('../utils/cookieOptions');

const router = express.Router();


const ACCESS_TOKEN_TTL = '1h';
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL = '7d';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_COOKIE = 'user_google_oauth_state';
const STATE_TTL_MS = 5 * 60 * 1000;
const isProd = () => process.env.NODE_ENV === 'production';

const clientUrl = () => process.env.CLIENT_URL || 'http://localhost:3001';

const loginError = (res, code) => res.redirect(`${clientUrl()}/login?error=${code}`);

const stateCookieOptions = () => ({
    httpOnly: true,
    secure: isProd(),
    // Lax (not None) so the cookie survives the cross-site top-level GET
    // that Google sends back to the callback.
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_TTL_MS
});

const timingSafeEqualStr = (a, b) => {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
};


router.get('/auth/google', (req, res) => {
    // Fail loudly-but-gracefully when the deployment has no Google client
    // configured. Without this the user gets dumped on a raw Google
    // "invalid_client" error page with no way back.
    if (!isGoogleConfigured()) {
        return loginError(res, 'google_unconfigured');
    }
    // CSRF on the OAuth flow: the same random state goes into a short-lived
    // httpOnly cookie and the redirect URL, compared with constant-time eq
    // in the callback so an attacker can't smuggle their own `code` into a
    // victim's session.
    const state = crypto.randomBytes(32).toString('base64url');
    res.cookie(STATE_COOKIE, state, stateCookieOptions());
    res.redirect(getGoogleAuthURL(state));
});


router.get('/auth/google/callback', async (req, res) => {
    const { code, state, error: googleError } = req.query;

    // Always clear the state cookie regardless of outcome.
    res.clearCookie(STATE_COOKIE, { ...stateCookieOptions(), maxAge: undefined });

    if (googleError || !code) {
        return loginError(res, 'google_cancelled');
    }

    const stateCookie = req.cookies && req.cookies[STATE_COOKIE];
    if (
        typeof state !== 'string' ||
        typeof stateCookie !== 'string' ||
        !timingSafeEqualStr(state, stateCookie)
    ) {
        return loginError(res, 'google_state_invalid');
    }

    try {
        const { user: profile } = await getGoogleUser(code);

        const email = String(profile.email || '').toLowerCase().trim();
        if (!email) {
            return loginError(res, 'google_no_email');
        }
        // Refuse unverified Google emails — otherwise anyone controlling an
        // unverified address at an IdP could sign in as the matching local
        // account.
        if (profile.email_verified !== true && profile.email_verified !== 'true') {
            return loginError(res, 'google_email_unverified');
        }

        let user = await UserModel.findOne({ email });

        if (user && !user.isGoogleUser) {
            // Account-takeover guard: this email already belongs to a
            // password account. Don't silently hand the session to whoever
            // controls the Google address — the owner can sign in with
            // their password instead.
            return loginError(res, 'email_already_registered');
        }

        if (!user) {
            user = await UserModel.create({
                name: profile.name || profile.given_name || email,
                email,
                isGoogleUser: true
            });
        }

        const accessToken = jwt.sign(
            { _id: user._id, email: user.email, name: user.name, role: user.role, type: 'access' },
            process.env.JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_TTL }
        );

        const refreshToken = jwt.sign(
            { _id: user._id, email: user.email, type: 'refresh-user' },
            process.env.JWT_SECRET,
            { expiresIn: REFRESH_TOKEN_TTL }
        );

        res.cookie('userToken', accessToken, authCookieOptions(ACCESS_TOKEN_TTL_MS));
        res.cookie('userRefreshToken', refreshToken, authCookieOptions(REFRESH_TOKEN_TTL_MS));

        // Short-lived, JS-readable handoff cookie so the SPA's callback page
        // can greet the user by name without an extra round trip. Consumed
        // and cleared by /authenticate below.
        res.cookie('userInfo', JSON.stringify({ name: user.name, email: user.email }), {
            secure: isProd(),
            sameSite: isProd() ? 'None' : 'Lax',
            maxAge: ACCESS_TOKEN_TTL_MS,
            path: '/'
        });

        return res.redirect(`${clientUrl()}/auth/google/callback`);

    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[users] Google auth error:', error.message);
        return loginError(res, 'google_failed');
    }
});


router.get('/authenticate', (req, res) => {
    const infoCookie = req.cookies && req.cookies.userInfo;

    if (infoCookie) {
        try {
            const userData = JSON.parse(infoCookie);
            res.clearCookie('userInfo', clearCookieOptions());
            return res.status(200).json({ success: true, user: userData });
        } catch (e) {
            return res.status(400).json({ success: false, message: 'Malformed user info cookie' });
        }
    }
    res.status(404).json({ success: false, message: 'No user data found.' });
});

module.exports = router;
