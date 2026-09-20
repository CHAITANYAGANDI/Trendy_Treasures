// Per-test-file setup (jest `setupFilesAfterEnv`) — runs after the test
// framework is installed, so `jest` and the lifecycle hooks are available.
//
// Two jobs:
//   1. No real email leaves the process (see mailMock).
//   2. The signup OTP is deterministic, so a failing assertion reads
//      "expected 123456" instead of a different number every run.
//
// Neither touches production code: MailService, OtpService and the
// controllers run exactly as they do in production.

const crypto = require('crypto');
const mailMock = require('./mailMock');

// The fixed code every signup OTP resolves to during tests.
const TEST_SIGNUP_OTP = '123456';

const realRandomInt = crypto.randomInt;
let randomIntSpy = null;

beforeAll(() => {
    mailMock.install();

    // MailService generates codes with crypto.randomInt(100000, 1000000).
    // Pin only that exact range and delegate every other caller to the real
    // implementation, so nothing else silently loses its randomness.
    try {
        randomIntSpy = jest.spyOn(crypto, 'randomInt').mockImplementation((...args) => {
            if (args.length === 2 && args[0] === 100000 && args[1] === 1000000) {
                return Number(TEST_SIGNUP_OTP);
            }
            return realRandomInt.apply(crypto, args);
        });
    } catch {
        // If the runtime makes crypto.randomInt non-writable, carry on: the
        // helpers read the OTP out of the captured email rather than assuming
        // a fixed value, so the suite still works — just non-deterministically.
        randomIntSpy = null;
    }
});

beforeEach(() => {
    mailMock.reset();
});

afterAll(() => {
    if (randomIntSpy) randomIntSpy.mockRestore();
    mailMock.restore();
});

module.exports = { TEST_SIGNUP_OTP };
