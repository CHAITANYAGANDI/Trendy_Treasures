const request = require('supertest');
const {
    getApp,
    waitForMongo,
    clearDatabase,
    closeMongo,
    registerAndLogin,
    registerAndVerify,
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

// globalSetup allows this origin via CORS_ORIGINS.
const SPA_ORIGIN = 'http://localhost:3002';
const CALLBACK = `${SPA_ORIGIN}/admin/client/callback`;

describe('login field validation', () => {
    test('a three-character username can sign in (matches the signup minimum)', async () => {
        await registerAndVerify({ username: 'abc', email: 'abc@example.com' });

        await request(app)
            .post('/auth/login')
            .send({ username: 'abc', password: STRONG_PW })
            .expect(200);
    });
});

// The EJS consent page an admin signs into while authorizing a provider.
describe('consent page (/auth/client/login) accepts username or email', () => {
    const setUpCredential = async ({ username, email }) => {
        const session = await registerAndLogin({ username, email });
        const created = await request(app)
            .post('/auth/credentials')
            .set('Cookie', session.asHeader)
            .set('x-csrf-token', session.jar.csrfToken)
            .send({ api_name: 'Orders', api_url: 'http://localhost:8000/orders', redirect_uri: CALLBACK })
            .expect(201);
        return created.body.client_id;
    };

    const consentLogin = (clientId, identifier) =>
        request(app)
            .post('/auth/client/login')
            .set('Origin', SPA_ORIGIN)
            .set('Cookie', `client_id=${clientId}`)
            .type('form')
            .send({ username: identifier, password: STRONG_PW, callbackUrl: CALLBACK });

    test('signing in with the email redirects with the stored username', async () => {
        const clientId = await setUpCredential({ username: 'nora', email: 'nora@example.com' });

        const res = await consentLogin(clientId, 'Nora@Example.com').expect(302);

        // /auth/authorize looks the owner up by exact username, so the
        // redirect must carry `nora`, not the email that was typed.
        const location = new URL(res.headers.location);
        expect(location.origin + location.pathname).toBe(CALLBACK);
        expect(location.searchParams.get('username')).toBe('nora');
        expect(location.searchParams.get('client_id')).toBe(clientId);
    });

    test('signing in with the username still works', async () => {
        const clientId = await setUpCredential({ username: 'omar', email: 'omar@example.com' });

        const res = await consentLogin(clientId, 'omar').expect(302);

        expect(new URL(res.headers.location).searchParams.get('username')).toBe('omar');
    });

    test('a wrong password via email is refused', async () => {
        const clientId = await setUpCredential({ username: 'pia', email: 'pia@example.com' });

        await request(app)
            .post('/auth/client/login')
            .set('Origin', SPA_ORIGIN)
            .set('Cookie', `client_id=${clientId}`)
            .type('form')
            .send({ username: 'pia@example.com', password: 'WrongPass1!', callbackUrl: CALLBACK })
            .expect(403);
    });
});
