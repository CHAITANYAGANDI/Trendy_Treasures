const bcrypt = require('bcryptjs');
const ClientModel = require('../Models/Client');
const {
    getOtpRecord,
    compareOtp,
    incrementAttempts,
    deleteOtp,
    MAX_ATTEMPTS
} = require('../Services/OtpService');
const { isStrongPassword, STRONG_PASSWORD_MESSAGE } = require('../utils/passwordPolicy');

const BCRYPT_COST = 12;

// Checks a submitted recovery code WITHOUT consuming it. Both steps of the
// reset flow call this against the same Otp record, so wrong guesses on
// /verify-reset-code and /reset-password share one MAX_ATTEMPTS budget —
// splitting the flow into two requests doesn't widen the brute-force window.
//
// Returns null on a match, or the { status, body } to send back. `code` lets
// the SPA decide where to send the user (retry vs. request a new code)
// without parsing the human-readable message.
const checkRecoveryCode = async (email, otp) => {
    const record = await getOtpRecord(email, 'recovery');
    if (!record) {
        return {
            status: 400,
            body: { success: false, code: 'OTP_EXPIRED', message: 'Code is invalid or has expired' }
        };
    }

    if (record.attempts >= MAX_ATTEMPTS) {
        await deleteOtp(email, 'recovery');
        return {
            status: 429,
            body: {
                success: false,
                code: 'OTP_LOCKED',
                message: 'Too many incorrect attempts. Request a new code.'
            }
        };
    }

    const matches = await compareOtp(otp, record);
    if (!matches) {
        const attempts = await incrementAttempts(email, 'recovery');
        const remaining = MAX_ATTEMPTS - (attempts ?? MAX_ATTEMPTS);
        return {
            status: 400,
            body: {
                success: false,
                code: 'OTP_INCORRECT',
                message: `Incorrect code. ${Math.max(0, remaining)} attempt(s) remaining.`
            }
        };
    }

    return null;
};

const hasCode = (otp) => typeof otp === 'string' || typeof otp === 'number';

// Step 2 of 3: prove the mailed code before the SPA asks for a new password.
// The code stays live so /reset-password can re-check it; the record's
// 10-minute TTL still bounds the whole flow.
const verifyResetCode = async (req, res) => {
    try {
        const { email, otp } = req.body || {};

        if (typeof email !== 'string' || !email.trim() || !hasCode(otp)) {
            return res.status(400).json({ success: false, message: 'Email and code are required' });
        }

        const failure = await checkRecoveryCode(email.toLowerCase().trim(), otp);
        if (failure) {
            return res.status(failure.status).json(failure.body);
        }

        return res.status(200).json({ success: true, message: 'Code verified' });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('verifyResetCode error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to verify code' });
    }
};

// Step 3 of 3: set the new password. Re-checks the code rather than trusting
// that step 2 happened — the code is the only proof of mailbox ownership.
const resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body || {};

        if (typeof email !== 'string' || !hasCode(otp) || typeof newPassword !== 'string') {
            return res.status(400).json({ success: false, message: 'Email, code, and new password are required' });
        }
        if (!isStrongPassword(newPassword)) {
            return res.status(400).json({ success: false, message: STRONG_PASSWORD_MESSAGE });
        }

        const normalized = email.toLowerCase().trim();
        const failure = await checkRecoveryCode(normalized, otp);
        if (failure) {
            return res.status(failure.status).json(failure.body);
        }

        const client = await ClientModel.findOne({ email: normalized });
        if (!client) {
            await deleteOtp(normalized, 'recovery');
            return res.status(404).json({ success: false, message: 'Account not found' });
        }

        client.password = await bcrypt.hash(newPassword, BCRYPT_COST);
        // Bump tokenVersion — any other live session/refresh token on
        // another device is now dead. Critical for the "I think someone
        // else has access" reset flow.
        client.tokenVersion = (client.tokenVersion || 0) + 1;
        await client.save();
        await deleteOtp(normalized, 'recovery');

        return res.status(200).json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('resetPassword error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to reset password' });
    }
};

module.exports = { verifyResetCode, resetPassword };
