const bcrypt = require('bcryptjs');
const ClientModel = require("../Models/Client");
const { authCookieOptions } = require('../utils/cookieOptions');
const {
    signAccessToken,
    signRefreshToken,
    ACCESS_TOKEN_TTL_MS,
    REFRESH_TOKEN_TTL_MS
} = require('../utils/tokens');
const { issueCsrfToken } = require('../Middlewares/csrf');
const { loginLookupQuery } = require('../utils/loginIdentifier');


const login = async (req, res) => {

    try {

        const { username, password } = req.body;

        // `username` may also be the account email — see loginIdentifier.js.
        const client = await ClientModel.findOne(loginLookupQuery(username));

        const errorMessage = 'Invalid Credentials';

        if (!client) {
            return res.status(403).json({ message: errorMessage, success: false });
        }

        // Google-only accounts have no local password hash. Returning the
        // same generic error avoids leaking which sign-in method the
        // account uses.
        if (!client.password) {
            return res.status(403).json({ message: errorMessage, success: false });
        }

        const passwordComparison = await bcrypt.compare(password, client.password);

        if (!passwordComparison) {
            return res.status(403).json({ message: errorMessage, success: false })
        }

        res.cookie('authToken', signAccessToken(client), authCookieOptions(ACCESS_TOKEN_TTL_MS));
        res.cookie('authRefreshToken', signRefreshToken(client), authCookieOptions(REFRESH_TOKEN_TTL_MS));
        // Return the CSRF token in the body so the SPA can cache it —
        // cross-registrable-domain deploys (e.g. Render) can't read the
        // cookie via document.cookie. See SessionController.me for full
        // rationale.
        const csrfToken = issueCsrfToken(res);

        res.status(200).json({
            message: "Access Granted",
            success: true,
            client: {
                username: client.username,
                name: client.name
            },
            csrfToken
        })

    } catch (err) {
        res.status(500).json({
            message: "Internal server error",
            success: false
        })
    }
};


module.exports = login;
