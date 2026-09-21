const axios = require('axios');
const jwt = require('jsonwebtoken');

// User and admin sessions are kept strictly separate by cookie name. Each
// middleware below reads ONLY its own cookie so an admin session cannot leak
// into user-side endpoints (or vice versa) when both cookies happen to be set
// in the same browser. Mixing them is what caused /auth/me to return the
// admin user, and /auth/logout to leave the admin session alive.

const fromAuthHeader = (req) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader === 'null') return null;
    if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
    return authHeader;
};

// Per HTTP semantics: 401 = not authenticated (no/invalid/expired token),
// 403 = authenticated but lacks permission. The frontend's apiFetch only
// auto-refreshes on 401, so missing-cookie cases MUST return 401 to let
// the 7-day refresh token kick in. Returning 403 here was why expired
// admin sessions surfaced as "Admin token not provided" toasts instead
// of transparently refreshing.

const verifyJwtAndAttach = (token, req, res, next) => {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        return next();
    } catch (error) {
        console.error('Token verification failed:', error.message);
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Unauthorized: Token has expired' });
        }
        return res.status(401).json({ message: 'Unauthorized: Token verification failed' });
    }
};

const ensureAuthorized = async (req, res, next) => {
    const cookieToken = req.cookies && req.cookies.userToken;
    const headerToken = fromAuthHeader(req);
    const token = cookieToken || headerToken;

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized: Token not provided' });
    }

    try {
        if (token.startsWith('ya29.')) {
            const response = await axios.get('https://www.googleapis.com/oauth2/v3/tokeninfo', {
                params: { access_token: token },
            });

            if (response.data.aud === process.env.GOOGLE_CLIENT_ID) {
                req.user = response.data;
                return next();
            }
            return res.status(401).json({ message: 'Unauthorized: Invalid Google Token' });
        }

        return verifyJwtAndAttach(token, req, res, next);
    } catch (error) {
        console.error('Token verification failed:', error.message);
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Unauthorized: Token has expired' });
        }
        return res.status(401).json({ message: 'Unauthorized: Token verification failed' });
    }
};

// Optional authentication: attach req.user when a valid session is present,
// and carry on quietly when it is not.
//
// POST /checkout/intent must stay reachable without a session — the referral
// code is the capability, and the endpoint is documented as unauthenticated.
// But when a signed-in buyer checks out, the intent has to record who they
// are, because completeIntent() clears the ordered lines out of their cart
// by matching on that userId. With no user attached the intent was stored
// with userId: null, the clear was skipped, and items stayed in the cart
// after the provider reported the order placed.
const attachUserIfPresent = async (req, res, next) => {
    const token = (req.cookies && req.cookies.userToken) || fromAuthHeader(req);
    if (!token) return next();

    try {
        if (token.startsWith('ya29.')) {
            const response = await axios.get('https://www.googleapis.com/oauth2/v3/tokeninfo', {
                params: { access_token: token },
            });
            if (response.data.aud === process.env.GOOGLE_CLIENT_ID) {
                req.user = response.data;
            }
        } else {
            req.user = jwt.verify(token, process.env.JWT_SECRET);
        }
    } catch (error) {
        // Expired or invalid simply means "no user" on this request. Never
        // reject — the endpoint is valid without a session.
        console.warn('attachUserIfPresent: ignoring token –', error.message);
    }

    return next();
};

const ensureAdminAuthorized = (req, res, next) => {
    const token = req.cookies && req.cookies.adminToken;
    if (!token) {
        return res.status(401).json({ message: 'Unauthorized: Admin token not provided' });
    }
    return verifyJwtAndAttach(token, req, res, next);
};

module.exports = ensureAuthorized;
module.exports.ensureAuthorized = ensureAuthorized;
module.exports.ensureAdminAuthorized = ensureAdminAuthorized;
module.exports.attachUserIfPresent = attachUserIfPresent;
