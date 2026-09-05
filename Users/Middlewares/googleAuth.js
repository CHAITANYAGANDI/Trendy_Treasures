const axios = require('axios');

require('dotenv').config();

// The storefront always talks to Users THROUGH the APIGateway, so the
// OAuth round-trip has to stay on the gateway's origin too. If the
// redirect_uri pointed straight at Users (:7001), Google would drop the
// browser on a host that never sees the `user_google_oauth_state` cookie
// we set on the gateway origin — and the session cookies minted in the
// callback would land on the wrong host for the SPA to ever send them.
// Locally this is masked (cookies are shared across ports on localhost);
// on Render the two are different registrable domains and it breaks.
const getRedirectUri = () =>
  process.env.GOOGLE_REDIRECT_URI ||
  'http://localhost:7000/api/v1/user/auth/google/callback';

const isGoogleConfigured = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

function getGoogleAuthURL(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: getRedirectUri(),
    scope: 'openid email profile',
    response_type: 'code',
    access_type: 'online',
    prompt: 'select_account'
  });
  if (state) params.set('state', state);
  return `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
}

// Exchanges the one-time code for a profile. Deliberately does NO database
// work: provisioning lives in the router so the account-takeover guard
// (existing password account with the same email) runs before any write
// and can redirect the browser to a real error page.
async function getGoogleUser(code) {
  const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: getRedirectUri(),
    grant_type: 'authorization_code'
  });

  const accessToken = tokenResponse.data.access_token;

  const userResponse = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  return { accessToken, user: userResponse.data };
}

module.exports = {
  getGoogleAuthURL,
  getGoogleUser,
  getRedirectUri,
  isGoogleConfigured
};
