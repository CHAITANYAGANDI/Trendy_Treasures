const express = require('express');
const router = express.Router();

const { createIntent, getIntent, completeIntent } = require('../Controllers/CheckoutIntentController');
const { attachUserIfPresent } = require('../Middlewares/Authorization');

// All endpoints are intentionally unauthenticated. The referralCode itself is
// the capability — anyone holding a valid code can read the intent. Since the
// intent contains no PII (just provider product ids and quantities), this is
// safe and matches the aggregator-to-provider hand-off model where neither
// side needs to share user identity through the redirect.

// attachUserIfPresent does not gate the route — it only records WHO is
// checking out when a session cookie is present. completeIntent() needs that
// to clear the ordered lines from the buyer's cart once the provider reports
// the order placed; without it the intent was anonymous and the cart kept
// showing items after checkout.
router.post('/intent', attachUserIfPresent, createIntent);

router.get('/intent/:referralCode', getIntent);

router.post('/intent/:referralCode/complete', completeIntent);

module.exports = router;
