// Test helpers. The app is loaded lazily so globalSetup's env writes are
// in place before any controller imports run.

const mongoose = require('mongoose');

let app;
const getApp = () => {
    if (!app) app = require('../app');
    return app;
};

// supertest writes cookies as a `set-cookie` array. Parse into a
// { name: value } map so tests can read/echo specific cookies and an
// `asHeader` string that can be replayed via `.set('Cookie', ...)`.
const parseSetCookies = (res) => {
    const raw = res.headers['set-cookie'] || [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const jar = {};
    const pairs = [];
    for (const line of arr) {
        const first = line.split(';', 1)[0];
        const eq = first.indexOf('=');
        if (eq === -1) continue;
        const name = first.slice(0, eq);
        const value = first.slice(eq + 1);
        jar[name] = value;
        pairs.push(`${name}=${value}`);
    }
    return { jar, asHeader: pairs.join('; ') };
};

// Wait until Mongo is connected. Tests that touch the DB should await
// this once before they start — globalSetup hands us the URI but the
// connection itself opens asynchronously when app.js loads dbConnection.
const waitForMongo = async () => {
    if (mongoose.connection.readyState === 1) return;
    await new Promise((resolve, reject) => {
        mongoose.connection.once('open', resolve);
        mongoose.connection.once('error', reject);
    });
};

// Wipe every collection between test files for isolation. Faster than
// dropping and re-creating the database.
const clearDatabase = async () => {
    if (mongoose.connection.readyState !== 1) return;
    const cols = await mongoose.connection.db.collections();
    await Promise.all(cols.map((c) => c.deleteMany({})));
};

const closeMongo = async () => {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
    }
};

const request = require('supertest');
const mailMock = require('./mailMock');

const STRONG_PW = 'TestPass1!';

// Step 1 only: POST /auth/register. Creates NO Client — it mails an OTP and
// sets the short-lived `pendingSignup` cookie. Returns the parsed cookies
// plus the code that was mailed, so callers can drive step 2.
const startRegistration = async ({
    name = 'Test User',
    username,
    email,
    password = STRONG_PW
} = {}) => {
    const res = await request(getApp())
        .post('/auth/register')
        .send({ name, username, email, password })
        .expect(200);

    const cookies = parseSetCookies(res);
    return { res, ...cookies, otp: mailMock.lastOtpFor(email) };
};

// Step 2: POST /auth/register/verify with the mailed OTP. This is what
// actually creates the Client and auto-logs it in, so the returned cookies
// already include authToken / authRefreshToken / csrfToken.
const completeRegistration = async ({ pendingCookies, otp }) => {
    const res = await request(getApp())
        .post('/auth/register/verify')
        .set('Cookie', pendingCookies)
        .send({ otp })
        .expect(200);

    return { res, ...parseSetCookies(res) };
};

// Full two-step signup. Returns the session cookies minted by verification.
const registerAndVerify = async (opts) => {
    const started = await startRegistration(opts);

    // Guard the preconditions here rather than in every caller: a missing
    // cookie or OTP means the flow broke upstream, and failing at the point
    // of the real assertion would be confusing.
    if (!started.jar.pendingSignup) {
        throw new Error('POST /auth/register did not set a pendingSignup cookie');
    }
    if (!started.otp) {
        throw new Error(`No signup OTP was mailed to ${opts && opts.email}`);
    }

    return completeRegistration({ pendingCookies: started.asHeader, otp: started.otp });
};

/**
 * Register a user and return cookies for authenticated routes.
 *
 * Verification already auto-logs the user in, so by default we hand back the
 * cookies it issued — one fewer round trip, and it matches what a real
 * browser ends up holding. Pass `{ separateLogin: true }` when a test needs a
 * distinct session (e.g. simulating a second device).
 */
const registerAndLogin = async (opts, { separateLogin = false } = {}) => {
    const verified = await registerAndVerify(opts);
    if (!separateLogin) {
        return { jar: verified.jar, asHeader: verified.asHeader };
    }

    const loginRes = await request(getApp())
        .post('/auth/login')
        .send({ username: opts.username, password: opts.password || STRONG_PW })
        .expect(200);

    return parseSetCookies(loginRes);
};

module.exports = {
    getApp,
    parseSetCookies,
    waitForMongo,
    clearDatabase,
    closeMongo,
    startRegistration,
    completeRegistration,
    registerAndVerify,
    registerAndLogin,
    mailMock,
    STRONG_PW
};
