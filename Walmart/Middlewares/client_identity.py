"""Portable client identity + proxy trust (Python port).

Mirrors the Node module at APIGateway/middleware/clientIdentity.js and its
synchronised copies under Users/, Amazon/ and Auth/server/. Kept as a
separate implementation because `gcloud run deploy --source ./Walmart`
uploads only that directory, and because this service is Flask rather than
Express. Behaviour must stay in step with the Node copies.

WHY THIS EXISTS

Rate limiting is only as good as its answer to "who is this caller". Get it
wrong in one direction and every shopper shares a single bucket (a
self-inflicted denial of service). Get it wrong in the other and any caller
mints a fresh bucket per request just by setting a header.

The previous implementation read ``CF-Connecting-IP`` unconditionally,
because Render serves *.onrender.com through Cloudflare, which sets that
header and overwrites whatever the caller sent. That reasoning does not
transfer: on a platform with no Cloudflare in front -- Cloud Run -- nothing
strips the header, so it is entirely caller-controlled and trusting it is a
free rate-limit bypass. An edge header is therefore honoured only when the
deployment explicitly declares an edge known to set it.

TRUST ORDER

1. ``x-real-client-ip``, but only when ``x-internal-auth`` compares equal to
   INTERNAL_AUTH_SECRET using a constant-time comparison. Only our own
   gateway sends that pair. Required because gateway-proxied traffic all
   arrives from one egress address.
2. A declared platform edge header (Cloudflare's CF-Connecting-IP on
   Render) -- opt-in per platform, never by default.
3. The remote address as resolved by ProxyFix from an EXPLICIT proxy-hop
   count.

An unauthenticated caller-supplied header is never trusted at any step.
"""

import hmac
import os

# x_for        -- how many proxy hops in front of the app may be trusted to
#                 have written X-Forwarded-For.
# edge_ip_header -- a header the edge both sets AND overwrites, so a caller
#                 cannot forge it. None means "trust no client header".
PLATFORM_PRESETS = {
    # Cloud Run places exactly one Google-managed front end in front of the
    # container and it controls the final X-Forwarded-For entry, so trusting
    # one hop resolves to the real caller. No edge header is trusted here:
    # nothing would strip a forged CF-Connecting-IP.
    'cloud-run': {'x_for': 1, 'edge_ip_header': None},
    # Cloudflare edge then Render's own router -- two hops. Cloudflare sets
    # and overwrites CF-Connecting-IP.
    'render': {'x_for': 2, 'edge_ip_header': 'cf-connecting-ip'},
    # Direct connections: trust no forwarded headers at all.
    'local': {'x_for': 0, 'edge_ip_header': None},
}

_PLATFORM_ALIASES = {
    'cloudrun': 'cloud-run',
    'google-cloud-run': 'cloud-run',
    'gcp': 'cloud-run',
}


def _is_production():
    return (
        os.environ.get('FLASK_ENV') == 'production'
        or os.environ.get('NODE_ENV') == 'production'
    )


def resolve_platform():
    """Name of the deployment platform.

    The production default is ``cloud-run`` because it is the conservative
    choice: one trusted hop and no trusted caller headers. If that default is
    wrong for a Render deployment the failure mode is coarser rate-limit
    buckets -- annoying, not exploitable. Defaulting the other way would
    trust a forgeable header on Cloud Run, which is exploitable. Render
    deployments must set DEPLOYMENT_PLATFORM=render explicitly.
    """
    fallback = 'cloud-run' if _is_production() else 'local'
    raw = (os.environ.get('DEPLOYMENT_PLATFORM') or '').strip().lower()
    if not raw:
        return fallback
    name = _PLATFORM_ALIASES.get(raw, raw)
    if name in PLATFORM_PRESETS:
        return name
    print(
        '[client_identity] unknown DEPLOYMENT_PLATFORM="%s" - using "%s"'
        % (raw, fallback)
    )
    return fallback


def platform_preset():
    return PLATFORM_PRESETS[resolve_platform()]


def proxy_fix_hops():
    """``x_for`` value for werkzeug's ProxyFix.

    TRUST_PROXY overrides the preset for topologies without a name here.
    Non-numeric values are ignored rather than guessed at, since ProxyFix
    only accepts a hop count.
    """
    preset = platform_preset()['x_for']
    override = (os.environ.get('TRUST_PROXY') or '').strip()
    if not override:
        return preset
    if override.isdigit():
        return int(override)
    print(
        '[client_identity] TRUST_PROXY="%s" is not a hop count - using the %s '
        'preset (%d)' % (override, resolve_platform(), preset)
    )
    return preset


def has_internal_auth(request):
    """True only when the request carries our own gateway's shared secret."""
    secret = os.environ.get('INTERNAL_AUTH_SECRET')
    provided = request.headers.get('x-internal-auth')
    if not secret or not provided:
        return False
    try:
        return hmac.compare_digest(str(provided), str(secret))
    except Exception:
        return False


def resolve_client_ip(request, remote_address_fn, trust_gateway_header=True):
    """Return ``(ip, source)`` for the caller.

    ``source`` is one of ``gateway``, ``edge`` or ``socket``.
    """
    if trust_gateway_header and has_internal_auth(request):
        forwarded = request.headers.get('x-real-client-ip')
        if forwarded:
            return str(forwarded), 'gateway'

    edge_header = platform_preset()['edge_ip_header']
    if edge_header:
        edge_ip = request.headers.get(edge_header)
        if edge_ip:
            return str(edge_ip), 'edge'

    return (remote_address_fn() or 'unknown'), 'socket'


def client_identity_key(request, remote_address_fn, trust_gateway_header=True):
    """Rate-limit key for the caller.

    Gateway-forwarded identities are namespaced under ``gw:`` so a caller
    reaching this service directly can never land in a proxied shopper's
    bucket. Flask-Limiter has no IPv6 subnet helper, so the raw address is
    used for direct callers, matching this service's previous behaviour.
    """
    ip, source = resolve_client_ip(request, remote_address_fn, trust_gateway_header)
    return 'gw:%s' % ip if source == 'gateway' else ip


def describe_platform():
    """One-line startup summary so misconfiguration is visible in the logs."""
    name = resolve_platform()
    edge = PLATFORM_PRESETS[name]['edge_ip_header'] or 'none'
    return 'platform=%s proxyHops=%d edgeHeader=%s' % (
        name,
        proxy_fix_hops(),
        edge,
    )
