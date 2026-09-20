const request = require('supertest');
const {
    getApp,
    waitForMongo,
    clearDatabase,
    closeMongo,
    parseSetCookies,
    registerAndLogin,
    registerAndVerify,
    startRegistration,
    completeRegistration,
    mailMock,
    STRONG_PW
} = require('./helpers');

let app;

beforeAll(async () => {
    app = getApp();
    await waitForMongo();
});

beforeEach(async () => {
    await clearDatabase();
});

afterAll(async () => {
    await closeMongo();
});


describe('register → login → /me', () => {
    test('happy path: register, login, fetch /me with cookies', async () => {
        const { jar, asHeader } = await registerAndLogin({
            username: 'alice',
            email: 'alice@example.com'
        });

        expect(jar.authToken).toBeTruthy();
        expect(jar.authRefreshToken).toBeTruthy();
        expect(jar.csrfToken).toBeTruthy();

        const meRes = await request(app)
            .get('/auth/me')
            .set('Cookie', asHeader)
            .expect(200);

        expect(meRes.body.success).toBe(true);
        expect(meRes.body.client.username).toBe('alice');
    });

    test('/me is 401 without auth cookies', async () => {
        await request(app).get('/auth/me').expect(401);
    });

    test('login with wrong password returns generic 403', async () => {
        // Must complete verification — registration alone creates no Client,
        // so an unverified signup would return 403 for the uninteresting
        // reason that the account doesn't exist.
        await registerAndVerify({ name: 'Bob', username: 'bobby', email: 'bob@example.com' });

        const res = await request(app)
            .post('/auth/login')
            .send({ username: 'bobby', password: 'WrongPass1!' })
            .expect(403);

        expect(res.body.message).toBe('Invalid Credentials');
    });

    test('login with unknown username returns the SAME generic 403', async () => {
        const res = await request(app)
            .post('/auth/login')
            .send({ username: 'ghost', password: STRONG_PW })
            .expect(403);

        // Identical to the wrong-password case — no enumeration oracle.
        expect(res.body.message).toBe('Invalid Credentials');
    });

    test('register echoes a generic conflict regardless of which field collides', async () => {
        // The conflict check runs against the clients collection, so the
        // first account has to be fully verified before a duplicate can
        // collide with anything.
        await registerAndVerify({ username: 'carol', email: 'carol@example.com' });

        const sameEmail = await request(app)
            .post('/auth/register')
            .send({ name: 'Test User', username: 'carol2', email: 'carol@example.com', password: STRONG_PW })
            .expect(409);

        const sameUsername = await request(app)
            .post('/auth/register')
            .send({ name: 'Test User', username: 'carol', email: 'carol2@example.com', password: STRONG_PW })
            .expect(409);

        // Both return the same message — caller can't tell which collided.
        expect(sameEmail.body.message).toBe(sameUsername.body.message);
    });
});


describe('two-step signup (OTP email verification)', () => {
    test('POST /auth/register mails a code and creates no Client yet', async () => {
        const started = await startRegistration({
            username: 'nate',
            email: 'nate@example.com'
        });

        expect(started.res.body.success).toBe(true);
        expect(started.jar.pendingSignup).toBeTruthy();
        // No session is issued at step 1 — that only happens after the OTP.
        expect(started.jar.authToken).toBeFalsy();
        expect(mailMock.mailCountFor('nate@example.com')).toBe(1);

        // The account genuinely does not exist yet.
        await request(app)
            .post('/auth/login')
            .send({ username: 'nate', password: STRONG_PW })
            .expect(403);

        // Completing verification is what creates it.
        const verified = await completeRegistration({
            pendingCookies: started.asHeader,
            otp: started.otp
        });
        expect(verified.res.body.success).toBe(true);
        expect(verified.jar.authToken).toBeTruthy();
        expect(verified.jar.authRefreshToken).toBeTruthy();
        expect(verified.jar.csrfToken).toBeTruthy();

        await request(app)
            .post('/auth/login')
            .send({ username: 'nate', password: STRONG_PW })
            .expect(200);
    });

    test('a wrong OTP is rejected, creates no Client, and the right one still works', async () => {
        const started = await startRegistration({
            username: 'olive',
            email: 'olive@example.com'
        });

        // Deliberately wrong code — must not be the deterministic test OTP.
        const wrong = started.otp === '000000' ? '999999' : '000000';
        const bad = await request(app)
            .post('/auth/register/verify')
            .set('Cookie', started.asHeader)
            .send({ otp: wrong })
            .expect(400);

        expect(bad.body.success).toBe(false);
        expect(bad.body.message).toMatch(/incorrect code/i);
        // A failed attempt must not have issued a session.
        const badJar = parseSetCookies(bad).jar;
        expect(badJar.authToken).toBeFalsy();

        await request(app)
            .post('/auth/login')
            .send({ username: 'olive', password: STRONG_PW })
            .expect(403);

        // The attempt counter burned one try but the record survives, so the
        // correct code still completes signup.
        const verified = await completeRegistration({
            pendingCookies: started.asHeader,
            otp: started.otp
        });
        expect(verified.jar.authToken).toBeTruthy();
    });

    test('POST /auth/register/verify without a pendingSignup cookie → 401', async () => {
        const res = await request(app)
            .post('/auth/register/verify')
            .send({ otp: '123456' })
            .expect(401);

        expect(res.body.success).toBe(false);
    });
});


describe('refresh + tokenVersion', () => {
    test('a fresh refresh cookie mints a new access cookie', async () => {
        const { jar, asHeader } = await registerAndLogin({
            username: 'dave',
            email: 'dave@example.com'
        });
        const originalAccess = jar.authToken;
        // Burn a clock tick so the new JWT's iat differs (otherwise the
        // payload — and the cookie — would be identical).
        await new Promise((r) => setTimeout(r, 1100));

        const res = await request(app)
            .post('/auth/refresh')
            .set('Cookie', asHeader)
            .expect(200);

        const { jar: jar2 } = parseSetCookies(res);
        expect(jar2.authToken).toBeTruthy();
        expect(jar2.authToken).not.toBe(originalAccess);
    });

    test('refresh without cookie → 401', async () => {
        await request(app).post('/auth/refresh').expect(401);
    });

    test('changing password bumps tokenVersion and invalidates other sessions', async () => {
        // Session A logs in.
        const A = await registerAndLogin({
            username: 'evelyn',
            email: 'eve@example.com'
        });

        // Session B logs in on a "different device" (just a second login).
        const loginB = await request(app)
            .post('/auth/login')
            .send({ username: 'evelyn', password: STRONG_PW })
            .expect(200);
        const B = parseSetCookies(loginB);

        // Session A changes the password — its own cookies should be
        // refreshed by the response, but session B's refresh cookie now
        // carries a stale tokenVersion.
        const NEW_PW = 'NewerPass2!';
        const change = await request(app)
            .patch('/auth/me/password')
            .set('Cookie', A.asHeader)
            .set('x-csrf-token', A.jar.csrfToken)
            .send({ currentPassword: STRONG_PW, newPassword: NEW_PW, confirmNewPassword: NEW_PW })
            .expect(200);

        expect(change.body.success).toBe(true);

        // Session B's refresh attempt should be rejected as "Session revoked".
        const stale = await request(app)
            .post('/auth/refresh')
            .set('Cookie', B.asHeader)
            .expect(401);
        expect(stale.body.message).toBe('Session revoked');

        // Session A's NEW cookies (returned from the password-change call)
        // should refresh cleanly because they were re-issued post-bump.
        const { asHeader: aAfter } = parseSetCookies(change);
        await request(app)
            .post('/auth/refresh')
            .set('Cookie', aAfter)
            .expect(200);
    });
});
