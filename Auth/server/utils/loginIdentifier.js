// Login forms accept either a username or the account email — password
// reset is email-based, so that's what people type afterwards. Usernames
// can't contain '@' (usernamePolicy.js), so an '@' unambiguously means an
// email, and the two lookups never collide. Emails are stored lowercased.
const loginLookupQuery = (identifier) => {
    const value = String(identifier).trim();
    return value.includes('@') ? { email: value.toLowerCase() } : { username: value };
};

module.exports = { loginLookupQuery };
