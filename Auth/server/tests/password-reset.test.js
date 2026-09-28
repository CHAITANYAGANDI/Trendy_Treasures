const request = require('supertest');
const {
    getApp,
    waitForMongo,
    clearDatabase,
    closeMongo,
    registerAndLogin,
    registerAndVerify,
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

const NEW_PW = 'FreshPass9x';
// setupAfterEnv pins every mailed code to 123456, so any other six digits
// is guaranteed wrong.
const WRONG_CODE = '654321';

// Step 1 of the reset flow. Returns the code that was mailed.
const requestResetCode = async (email) => {
    await request(app).post('/auth/forgot-password').send({ email }).expect(200);
    const otp = mailMock.lastOtpFor(email);
    if (!otp) throw new Error(`No reset code was mailed to ${email}`);
    return otp;
};

const verifyCode = (email, otp) =>
    request(app).post('/auth/verify-reset-code').send({ email, otp });

const resetPassword = (email, otp, newPassword = NEW_PW) =>
    request(app).post('/auth/reset-password').send({ email, otp, newPassword });

const login = (username, password) =>
    request(app).post('/auth/login').send({ username, password });


describe('login accepts username or email', () => {
    test('signing in with the account email succeeds', async () => {
        await registerAndVerify({ username: 'emma', email: 'emma@example.com' });

        const res = await login('emma@example.com', STRONG_PW).expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.client.username).toBe('emma');
    });

    test('email sign-in ignores case and surrounding whitespace', async () => {
        await registerAndVerify({ username: 'frank', email: 'frank@example.com' });

        await login('  Frank@Example.COM ', STRONG_PW).expect(200);
    });

    test('a wrong password via email returns the same generic 403', async () => {
        await registerAndVerify({ username: 'gina', email: 'gina@example.com' });

        const res = await login('gina@example.com', 'WrongPass1!').expect(403);

        expect(res.body.message).toBe('Invalid Credentials');
    });
});


describe('three-step password reset', () => {
    test('verify-reset-code accepts the mailed code without consuming it', async () => {
        await registerAndVerify({ username: 'hana', email: 'hana@example.com' });
        const otp = await requestResetCode('hana@example.com');

        const verified = await verifyCode('hana@example.com', otp).expect(200);
        expect(verified.body.success).toBe(true);

        // The same code still completes the reset afterwards.
        await resetPassword('hana@example.com', otp).expect(200);
    });

    test('a wrong code is rejected, and verify + reset share one attempt budget', async () => {
        await registerAndVerify({ username: 'ivan', email: 'ivan@example.com' });
        await requestResetCode('ivan@example.com');

        const first = await verifyCode('ivan@example.com', WRONG_CODE).expect(400);
        expect(first.body.code).toBe('OTP_INCORRECT');
        expect(first.body.message).toMatch(/4 attempt\(s\) remaining/);

        // A wrong guess on the reset step draws from the same counter.
        const second = await resetPassword('ivan@example.com', WRONG_CODE).expect(400);
        expect(second.body.code).toBe('OTP_INCORRECT');
        expect(second.body.message).toMatch(/3 attempt\(s\) remaining/);
    });

    test('after five wrong guesses even the right code is refused', async () => {
        await registerAndVerify({ username: 'jules', email: 'jules@example.com' });
        const otp = await requestResetCode('jules@example.com');

        for (let i = 0; i < 5; i += 1) {
            await verifyCode('jules@example.com', WRONG_CODE).expect(400);
        }

        const locked = await verifyCode('jules@example.com', otp).expect(429);
        expect(locked.body.code).toBe('OTP_LOCKED');

        // Locking deletes the record, so the user has to request a new code.
        const gone = await verifyCode('jules@example.com', otp).expect(400);
        expect(gone.body.code).toBe('OTP_EXPIRED');
    });

    test('verifying with no outstanding code returns OTP_EXPIRED', async () => {
        const res = await verifyCode('nobody@example.com', '123456').expect(400);
        expect(res.body.code).toBe('OTP_EXPIRED');
    });

    test('verify-reset-code requires both email and code', async () => {
        await request(app).post('/auth/verify-reset-code').send({ email: 'kai@example.com' }).expect(400);
        await request(app).post('/auth/verify-reset-code').send({ otp: '123456' }).expect(400);
    });

    test('end to end: new password works by email and username, the old one does not', async () => {
        await registerAndVerify({ username: 'lena', email: 'lena@example.com' });
        const otp = await requestResetCode('lena@example.com');

        await verifyCode('lena@example.com', otp).expect(200);
        await resetPassword('lena@example.com', otp).expect(200);

        // This is the exact sequence that used to fail: reset by email, then
        // sign in with that same email.
        await login('lena@example.com', NEW_PW).expect(200);
        await login('lena', NEW_PW).expect(200);
        await login('lena', STRONG_PW).expect(403);

        // The code is spent once the password changes.
        const replay = await resetPassword('lena@example.com', otp, 'AnotherPass7x').expect(400);
        expect(replay.body.code).toBe('OTP_EXPIRED');
    });

    test('reset bumps tokenVersion, so sessions from before the reset are revoked', async () => {
        const before = await registerAndLogin({ username: 'milo', email: 'milo@example.com' });
        const otp = await requestResetCode('milo@example.com');

        await resetPassword('milo@example.com', otp).expect(200);

        const stale = await request(app)
            .post('/auth/refresh')
            .set('Cookie', before.asHeader)
            .expect(401);
        expect(stale.body.message).toBe('Session revoked');
    });
});
