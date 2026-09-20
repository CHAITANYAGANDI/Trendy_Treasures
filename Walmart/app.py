import hmac
import json
import os
import uuid
from flask import Flask, request, jsonify, g, render_template, Response
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_talisman import Talisman
from dotenv import load_dotenv
from mongoengine.connection import get_connection
from Controllers.products_controller import product_api
from Controllers.order_controller import order_api
from Controllers.payment_controller import payment_api
from Models.db_connection import initialize_db

load_dotenv()

app = Flask(__name__, template_folder='templates', static_folder='static')

is_production = (
    os.environ.get('FLASK_ENV') == 'production'
    or os.environ.get('NODE_ENV') == 'production'
)

# Behind Render/Heroku/Nginx the real client IP is in X-Forwarded-For.
# Without this, flask-limiter would bucket every request by the LB's IP.
# Render fronts *.onrender.com with Cloudflare, so a request crosses two
# proxy layers (Cloudflare edge, then Render's router) — hence x_for=2.
# rate_limit_key() no longer depends on this being exactly right, since it
# reads CF-Connecting-IP first, but it still governs url_for/HTTPS detection.
from werkzeug.middleware.proxy_fix import ProxyFix
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=2, x_proto=1, x_host=1)


# ─── Security headers (Talisman) ───────────────────────────────────────
# In dev CSP would break the source-branded checkout page (which embeds
# Stripe.js and inline scripts), so we disable it there. In prod CSP is
# still off — tightening it needs a per-page policy rather than a global
# one, which is out of scope. The remaining defaults (HSTS in prod,
# X-Content-Type-Options, frame-deny, etc.) still apply.
Talisman(
    app,
    content_security_policy=None,
    force_https=is_production,
    strict_transport_security=is_production,
    referrer_policy='same-origin',
    frame_options='DENY',
)


# ─── Rate limiting (Flask-Limiter) ─────────────────────────────────────
# Walmart is publicly reachable on Render unless put on private
# networking, so the gateway's IP limit isn't sufficient on its own.
# /payments/* gets a tighter window because each call hits Stripe and
# costs money on abuse.

# Every request proxied by the APIGateway arrives from the gateway's single
# egress IP, so keying purely on the remote address lumped all shoppers into
# one bucket and 429'd the storefront under trivial load. The gateway sends
# the real client IP together with the shared internal secret; trust that IP
# only when the secret verifies, so a caller hitting this service directly
# cannot forge someone else's key.
def rate_limit_key():
    try:
        secret = os.environ.get('INTERNAL_AUTH_SECRET')
        provided = request.headers.get('x-internal-auth')
        real_ip = request.headers.get('x-real-client-ip')
        if secret and provided and real_ip and hmac.compare_digest(provided, secret):
            return f'gw:{real_ip}'
    except Exception:
        pass
    # Reached when this service is hit directly rather than via the gateway.
    # Prefer CF-Connecting-IP: Render fronts *.onrender.com with Cloudflare,
    # so the remote address resolves to a proxy drawn from a shared pool
    # (two proxy hops, not the one ProxyFix assumes) and would bucket
    # unrelated callers together. Cloudflare overwrites this header, so it
    # cannot be forged from outside.
    return request.headers.get('cf-connecting-ip') or get_remote_address()


limiter = Limiter(
    rate_limit_key,
    app=app,
    default_limits=[
        f"{os.environ.get('RATE_LIMIT_PER_MIN', '120')} per minute",
    ],
    storage_uri="memory://",
    headers_enabled=True,
)


allowed_origins = [
    o.strip()
    for o in os.environ.get('CORS_ORIGINS', 'http://localhost:3001').split(',')
    if o.strip()
]
def require_prod_env():
    if os.environ.get('FLASK_ENV') != 'production' and os.environ.get('NODE_ENV') != 'production':
        return
    required = [
        'MONGO_CONN',
        'SECRET',
        'AUTH_SERVER_URL',
        'INTERNAL_AUTH_SECRET',
        'TT_GATEWAY_URL',
        'CORS_ORIGINS',
        'STRIPE_SECRET_KEY',
        'STRIPE_PUBLISHABLE_KEY',
    ]
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise RuntimeError(f"Missing required production env vars: {', '.join(missing)}")


require_prod_env()


CORS(
    app,
    resources={r"/*": {"origins": allowed_origins, "supports_credentials": True}},
    expose_headers=['x-request-id', 'x-original-url'],
)


initialize_db()


@app.before_request
def assign_request_id():
    rid = request.headers.get('x-request-id') or str(uuid.uuid4())
    g.request_id = rid
    print(f"[walmart] [{rid}] {request.method} {request.path}", flush=True)


@app.after_request
def echo_request_id(response):
    if hasattr(g, 'request_id'):
        response.headers['x-request-id'] = g.request_id
    return response


@app.route('/health')
def health():
    try:
        get_connection().admin.command('ping')
        mongo_ok = True
    except Exception:
        mongo_ok = False
    return jsonify({
        'status': 'ok',
        'service': 'walmart',
        'mongo': mongo_ok,
    })


# ─── Source-branded mock storefront (provider redirect target) ─────────────
#
# TrendyTreasures (the aggregator) redirects the buyer here for the final
# checkout step, so the experience visually leaves the aggregator and lands
# on what looks like Walmart. The pages call back into the TrendyTreasures
# gateway to actually persist the order — this service never stores orders.
@app.route('/checkout')
def checkout_page():
    return render_template('checkout.html')


@app.route('/confirmation')
def confirmation_page():
    return render_template('confirmation.html')


# Exposes only the Stripe publishable key to the browser. The secret key
# stays server-side. Returned as JS so the checkout page can <script src> it
# before the main checkout.js runs.
@app.route('/config.js')
def config_js():
    pk = os.environ.get('STRIPE_PUBLISHABLE_KEY', '')
    gateway_url = os.environ.get('TT_GATEWAY_URL', '')
    storefront_url = os.environ.get('TRENDY_TREASURES_URL', '')
    return Response(
        f"window.STRIPE_PK = {json.dumps(pk)};\n"
        f"window.TT_GATEWAY_URL = {json.dumps(gateway_url)};\n"
        f"window.TRENDY_TREASURES_URL = {json.dumps(storefront_url)};",
        mimetype='application/javascript'
    )


app.register_blueprint(order_api, url_prefix='/orders')
app.register_blueprint(payment_api, url_prefix='/payments')
app.register_blueprint(product_api, url_prefix='/')

# Stripe-backed routes get a tighter limit on top of the default. Applied
# after blueprint registration so the limit attaches to the resolved
# endpoint names rather than to functions inside the blueprint module.
payments_limit = f"{os.environ.get('PAYMENTS_RATE_LIMIT_PER_MIN', '20')} per minute"
for rule in app.url_map.iter_rules():
    if rule.rule.startswith('/payments'):
        limiter.limit(payments_limit)(app.view_functions[rule.endpoint])


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8001))
    app.run(host='0.0.0.0', port=port, debug=False)
