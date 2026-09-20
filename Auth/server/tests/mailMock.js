// Stubs the Brevo HTTPS transport — and nothing else.
//
// We deliberately mock at the axios layer rather than mocking MailService or
// OtpService. That keeps the real production path under test: the controller
// still calls sendSignupOtp(), which still honours the resend cooldown, still
// generates the OTP, and still writes a real bcrypt-hashed Otp document via
// OtpService.setOtp(). The only thing that doesn't happen is the outbound
// request to api.brevo.com.
//
// Capturing the rendered message also gives tests the OTP without reaching
// into the database (the stored value is a bcrypt hash and can't be reversed),
// so verification is exercised exactly as a real user would: read the code
// from the email, post it to /auth/register/verify.

const axios = require('axios');

const sent = [];
let spy = null;

const install = () => {
    if (spy) return;
    spy = jest.spyOn(axios, 'post').mockImplementation(async (url, body) => {
        sent.push({ url, body });
        // Shape-compatible with a Brevo success response.
        return { status: 201, data: { messageId: 'test-message-id' } };
    });
};

const restore = () => {
    if (spy) {
        spy.mockRestore();
        spy = null;
    }
    sent.length = 0;
};

const reset = () => {
    sent.length = 0;
};

const sentMessages = () => sent.slice();

const OTP_PATTERN = /\b(\d{6})\b/;

// Most recent 6-digit code mailed to `email`, or null if nothing was sent.
const lastOtpFor = (email) => {
    const target = String(email).toLowerCase().trim();
    for (let i = sent.length - 1; i >= 0; i -= 1) {
        const body = sent[i].body || {};
        const recipients = Array.isArray(body.to) ? body.to : [];
        const addressed = recipients.some(
            (r) => String(r && r.email).toLowerCase().trim() === target
        );
        if (!addressed) continue;
        const match = OTP_PATTERN.exec(String(body.textContent || ''));
        if (match) return match[1];
    }
    return null;
};

const mailCountFor = (email) => {
    const target = String(email).toLowerCase().trim();
    return sent.filter((m) => {
        const recipients = Array.isArray(m.body && m.body.to) ? m.body.to : [];
        return recipients.some((r) => String(r && r.email).toLowerCase().trim() === target);
    }).length;
};

module.exports = { install, restore, reset, sentMessages, lastOtpFor, mailCountFor };
