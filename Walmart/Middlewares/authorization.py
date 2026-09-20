from flask import request, jsonify
from functools import wraps
from urllib.parse import urlparse, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import re
import time
import threading
import jwt
import os


_VERSION_PREFIX = re.compile(r'^/api/v\d+(?=/)')


def _strip_version(path):
    return _VERSION_PREFIX.sub('/api', path)


def _matches_api_url(original_url, api_url):
    if not original_url or not api_url:
        return False
    try:
        original_path = _strip_version(urlparse(original_url).path)
        api_path_raw = urlparse(api_url).path if api_url.startswith('http') else api_url
        api_path = _strip_version(api_path_raw)
        normalized = api_path[:-1] if api_path.endswith('/') else api_path
        return original_path == normalized or original_path.startswith(normalized + '/')
    except Exception:
        return False


# ─── Active-jti introspection cache ──────────────────────────────────────
#
# The auth server stamps a fresh jti onto the Credential row every time a
# token is minted (re-auth via /auth/authorize OR refresh via
# /auth/token/refresh). We compare it against the jti on the incoming JWT
# to detect superseded tokens — any prior token is implicitly revoked.
#
# Caching the lookup per client_id avoids an HTTP hop on every product
# request. TTL is short so that revocation propagates quickly; tune via
# AUTH_INTROSPECT_CACHE_TTL_MS if needed.

# AUTH_SERVER_URL may be a public host (https://x.onrender.com) or a Render
# internal one (http://auth:10000), with or without a trailing slash. Strip
# trailing slashes once so joins below can't produce a doubled slash.
_AUTH_SERVER_URL = os.environ.get('AUTH_SERVER_URL', 'http://localhost:5000').rstrip('/')
_INTROSPECT_CACHE_TTL_S = int(os.environ.get('AUTH_INTROSPECT_CACHE_TTL_MS', '30000')) / 1000.0
_jti_cache = {}
_jti_cache_lock = threading.Lock()


def _fetch_active_jti(client_id, bust_cache=False):
    if not bust_cache:
        now = time.time()
        with _jti_cache_lock:
            entry = _jti_cache.get(client_id)
            if entry and (now - entry['fetched_at']) < _INTROSPECT_CACHE_TTL_S:
                return entry['active_jti']

    url = f"{_AUTH_SERVER_URL}/auth/token/active/{quote(client_id, safe='')}"
    req = Request(url, method='GET')
    internal_secret = os.environ.get('INTERNAL_AUTH_SECRET')
    if internal_secret:
        req.add_header('x-internal-auth', internal_secret)

    try:
        with urlopen(req, timeout=5) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
            active_jti = payload.get('active_jti')
    except HTTPError as e:
        print(f"[walmart] Introspection failed for client_id={client_id}: HTTP {e.code}", flush=True)
        return None
    except URLError as e:
        print(f"[walmart] Introspection unreachable for client_id={client_id}: {e.reason}", flush=True)
        return None
    except Exception as e:
        print(f"[walmart] Introspection threw for client_id={client_id}: {e}", flush=True)
        return None

    with _jti_cache_lock:
        _jti_cache[client_id] = {'active_jti': active_jti, 'fetched_at': time.time()}
    return active_jti


def ensure_authenticated(func):
    @wraps(func)
    def wrapper(*args, **kwargs):

        auth = request.headers.get('productsauthorization')

        if not auth or auth == 'null':
            return jsonify({"error": "Unauthorized: missing token"}), 403

        try:
            decoded = jwt.decode(
                auth,
                os.getenv("SECRET"),
                algorithms=["HS256"]
            )
            request.inventory = decoded
            original_url = request.headers.get('x-original-url') or ''

            if not _matches_api_url(original_url, decoded.get('api_url', '')):
                return jsonify({
                    "error": "Invalid API URL. Access denied.",
                    "originalUrl": original_url,
                    "expectedApiUrl": decoded.get("api_url")
                }), 403

            # Reject tokens that have been superseded by a more recent mint.
            # On mismatch, retry the introspection lookup with cache bypassed —
            # a freshly refreshed token can arrive seconds after our last
            # cached lookup, and we don't want to reject the new token because
            # the cache still holds the old jti.
            #
            # The "Token verification failed" phrasing keeps the gateway's
            # existing isRefreshableFailure() matcher happy so the auto-
            # refresh + retry flow kicks in transparently.
            client_id = decoded.get('client_id')
            if client_id:
                active_jti = _fetch_active_jti(client_id)
                if active_jti and decoded.get('jti') != active_jti:
                    active_jti = _fetch_active_jti(client_id, bust_cache=True)
                if active_jti and decoded.get('jti') != active_jti:
                    print(
                        f"[walmart] Superseded token — client_id={client_id}, "
                        f"jwt.jti={(decoded.get('jti') or '')[:8]}..., active={active_jti[:8]}...",
                        flush=True
                    )
                    return jsonify({
                        "error": "Token verification failed: token has been superseded by a newer authorization for this client_id."
                    }), 403

        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token has expired"}), 403

        except jwt.InvalidSignatureError:
            return jsonify({
                "error": "Token signature verification failed. Check that SECRET matches the secret_key used to sign the token in Auth/server.",
            }), 403

        except Exception as e:
            return jsonify({"error": f"Token verification failed: {str(e)}"}), 403

        return func(*args, **kwargs)

    return wrapper
