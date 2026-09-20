const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const credsSchema = new Schema({
    client_id: { type: String, required: true, index: true },
    api_name: { type: String, required: true, index: true },
    api_url: { type: String, required: true },
    access_token: { type: String, required: true },

    // Refresh bookkeeping. Both are optional so documents written before
    // this existed stay valid and need no migration — the gateway decodes
    // `exp` from the token itself, which remains the source of truth. These
    // are for operators: "when does this lapse" and "when did we last renew"
    // answerable from the DB without decoding a JWT by hand.
    token_expires_at: { type: Date },
    refreshed_at: { type: Date }
});

credsSchema.index({ client_id: 1, api_name: 1 }, { unique: true });

const CredsModel = mongoose.model('creds', credsSchema);

module.exports = CredsModel;
