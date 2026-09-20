// Boots an in-memory MongoDB once per test run and exposes its URI to
// child processes via process.env. Jest's globalSetup runs before any
// test file is loaded, so the env is in place by the time controllers
// import dbConnection.js.

const { MongoMemoryServer } = require('mongodb-memory-server');

module.exports = async () => {
    const mongo = await MongoMemoryServer.create();
    process.env.__MONGO_URI__ = mongo.getUri();
    process.env.MONGO_CONN = mongo.getUri();

    // Test fixtures for required env vars. These bypass validateEnv's
    // production-mode strictness; NODE_ENV=test keeps us in dev rules.
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-padding';
    process.env.JWT_PROVIDER_SECRET = 'test-provider-secret-at-least-32-characters-padding';
    process.env.INTERNAL_AUTH_SECRET = 'test-internal-auth-secret-padding';
    process.env.CORS_ORIGINS = 'http://localhost:3002';
    process.env.AUTH_CLIENT_URL = 'http://localhost:3002';

    // Mail fixtures. sendSignupOtp() returns success:false when these are
    // unset, which makes POST /auth/register answer 500 and the whole signup
    // flow untestable. These are dummy values — tests/setupAfterEnv.js stubs
    // the axios transport, so nothing is ever sent to Brevo.
    process.env.BREVO_API_KEY = 'test-brevo-key-not-real';
    process.env.MAIL_FROM = 'AuthShield Test <no-reply@authshield.test>';

    // Hand the memory server to globalTeardown.
    globalThis.__MONGO_SERVER__ = mongo;
};
