const express = require("express");
const router = express.Router();

const register = require('../Controllers/ClientRegisterController');
const login = require('../Controllers/ClientLoginController');
const clientAPIDetails = require('../Controllers/ClientAPIDetailsController');
const clientAuthorization = require('../Controllers/ClientAuthorizationController');
const createCredential = require('../Services/CreateCredentialService');
const getCredentials = require('../Services/GetCredentialsService');
const deleteCredential = require('../Services/DeleteCredentialService');
const rotateCredentialSecret = require('../Services/RotateCredentialSecretService');
const updateUsername = require('../Services/UpdateUsernameService');
const updatePassword = require('../Services/UpdatePasswordService');
const deleteAccount = require('../Services/DeleteAccountService');
const forgotPassword = require('../Controllers/ForgotPasswordController');
const { verifyResetCode, resetPassword } = require('../Controllers/ResetPasswordController');
const { signupValidation, loginvalidation } = require('../Middlewares/clientCredsValidation');
const verifyToken = require("../Middlewares/verifyToken");
const renderLoginPage = require('../Controllers/OAuthLoginPageController');
const loginClients = require('../Controllers/OAuthLoginController');
const { me, logout } = require('../Controllers/SessionController');
const { refresh } = require('../Controllers/RefreshController');
const refreshProviderToken = require('../Controllers/TokenRefreshController');
const introspectActiveJti = require('../Controllers/TokenIntrospectController');
const verifySignupOtp = require('../Middlewares/verifySignupOtp');

const { requireCsrf } = require('../Middlewares/csrf');
const requireSameOrigin = require('../Middlewares/requireSameOrigin');
const {
    loginLimiter,
    forgotPasswordLimiter,
    resetPasswordLimiter,
    verifyResetCodeLimiter,
    registerLimiter,
    registerVerifyLimiter,
    refreshLimiter
} = require('../Middlewares/authRateLimit');



router.get('/client/login', renderLoginPage);

router.post('/login', loginLimiter, loginvalidation, login);

router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);

// Three-step reset: /forgot-password mails a code, /verify-reset-code proves
// it before the SPA asks for a new password, /reset-password re-checks the
// same code and sets the password. Both checks share one attempt counter.
router.post('/verify-reset-code', verifyResetCodeLimiter, verifyResetCode);

router.post('/reset-password', resetPasswordLimiter, resetPassword);

router.post('/refresh', refreshLimiter, refresh);

router.get('/me', verifyToken, me);

router.patch('/me/username', verifyToken, requireCsrf, updateUsername);

router.patch('/me/password', verifyToken, requireCsrf, updatePassword);

router.delete('/me/account', verifyToken, requireCsrf, deleteAccount);

router.post('/logout', requireCsrf, logout);

// EJS form POST — same-origin only (no CSRF token because the form is
// server-rendered, but the Origin header check is strict enough).
router.post('/client/login', requireSameOrigin, loginClients);

// Two-step signup: /register validates the form, stashes the pending profile
// in a `pendingSignup` JWT cookie, and mails a 6-digit OTP. /register/verify
// reads the cookie + OTP, creates the Client, and auto-logs the user in. The
// Client row only ever exists if the email was successfully verified.
router.post('/register', registerLimiter, signupValidation, register);

router.post('/register/verify', registerVerifyLimiter, verifySignupOtp);

router.post('/credentials', verifyToken, requireCsrf, createCredential);

router.delete('/credentials/:id', verifyToken, requireCsrf, deleteCredential);

router.post('/credentials/:id/rotate-secret', verifyToken, requireCsrf, rotateCredentialSecret);

router.get('/dashboard', verifyToken, getCredentials);

router.get('/creds/apiinfo/:id', verifyToken, clientAPIDetails);

router.post('/token', verifyToken, requireCsrf, clientAuthorization);

// /authorize is the S2S OAuth flow called by external app servers with
// their client secret. No browser cookie auth, so CSRF doesn't apply.
router.post('/authorize', clientAuthorization);

// Server-to-server: APIGateway calls this when an upstream provider rejects
// an expired JWT, so we can mint a fresh one without admin re-login. Gated
// by the assertion JWT (RS256) inside the controller — no cookie auth, no CSRF.
router.post('/token/refresh', refreshProviderToken);

// Server-to-server: Amazon/Walmart middlewares call this to learn the
// currently-active jti for a given client_id, so they can reject tokens
// that were superseded by a more recent re-auth or refresh. Gated by
// INTERNAL_AUTH_SECRET inside the controller.
router.get('/token/active/:clientId', introspectActiveJti);

module.exports = router;
