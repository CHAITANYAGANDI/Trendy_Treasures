"""Tests for Walmart's portable client-identity resolution.

Run from the Walmart/ directory:

    python -m unittest discover -s tests -t .

``tests/__init__.py`` makes this a package so that command works; discovery
otherwise reports "Start directory is not importable".

Uses only the standard library. pytest is deliberately not added to
requirements.txt: that file is what gets installed into the Cloud Run image,
and test tooling has no business in a production container.

``client_identity`` only ever calls ``request.headers.get(...)``, so a small
fake stands in for a Flask request and Flask itself is not needed here.
"""

import os
import sys
import unittest

# Redundant under `discover -t .` (Walmart/ is already the top-level dir on
# sys.path), but kept so this file also runs standalone:
#     python tests/test_client_identity.py
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from Middlewares.client_identity import (  # noqa: E402
    PLATFORM_PRESETS,
    client_identity_key,
    describe_platform,
    has_internal_auth,
    proxy_fix_hops,
    resolve_client_ip,
    resolve_platform,
)

SECRET = 'test-internal-secret-value'


class FakeRequest(object):
    def __init__(self, headers=None):
        self.headers = headers or {}


def remote_addr(value='10.0.0.1'):
    return lambda: value


class EnvTestCase(unittest.TestCase):
    """Restores os.environ after each test."""

    def setUp(self):
        self._saved = dict(os.environ)
        for key in ('DEPLOYMENT_PLATFORM', 'TRUST_PROXY', 'FLASK_ENV', 'NODE_ENV'):
            os.environ.pop(key, None)
        os.environ['INTERNAL_AUTH_SECRET'] = SECRET

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._saved)


class PlatformResolution(EnvTestCase):
    def test_names_and_aliases(self):
        for raw, expected in [
            ('cloud-run', 'cloud-run'),
            ('CloudRun', 'cloud-run'),
            (' GCP ', 'cloud-run'),
            ('render', 'render'),
            ('local', 'local'),
        ]:
            os.environ['DEPLOYMENT_PLATFORM'] = raw
            self.assertEqual(resolve_platform(), expected, raw)

    def test_unknown_value_fails_safe(self):
        os.environ['DEPLOYMENT_PLATFORM'] = 'heroku-ish'
        self.assertEqual(resolve_platform(), 'local')
        os.environ['FLASK_ENV'] = 'production'
        self.assertEqual(resolve_platform(), 'cloud-run')

    def test_production_default_is_conservative(self):
        # cloud-run trusts one hop and NO caller header. Defaulting to
        # `render` would trust a forgeable header where Cloudflare is absent.
        os.environ['FLASK_ENV'] = 'production'
        self.assertEqual(resolve_platform(), 'cloud-run')
        self.assertIsNone(PLATFORM_PRESETS['cloud-run']['edge_ip_header'])

    def test_local_is_the_non_production_default(self):
        self.assertEqual(resolve_platform(), 'local')


class ProxyHops(EnvTestCase):
    def test_hops_come_from_the_preset(self):
        for platform, expected in [('cloud-run', 1), ('render', 2), ('local', 0)]:
            os.environ['DEPLOYMENT_PLATFORM'] = platform
            self.assertEqual(proxy_fix_hops(), expected, platform)

    def test_numeric_override_is_honoured(self):
        os.environ['DEPLOYMENT_PLATFORM'] = 'cloud-run'
        os.environ['TRUST_PROXY'] = '3'
        self.assertEqual(proxy_fix_hops(), 3)

    def test_non_numeric_override_falls_back_to_the_preset(self):
        # ProxyFix only accepts a hop count; 'loopback' is meaningless here
        # and must not be coerced into something permissive.
        os.environ['DEPLOYMENT_PLATFORM'] = 'render'
        os.environ['TRUST_PROXY'] = 'loopback'
        self.assertEqual(proxy_fix_hops(), 2)

    def test_true_is_not_treated_as_a_hop_count(self):
        os.environ['DEPLOYMENT_PLATFORM'] = 'cloud-run'
        os.environ['TRUST_PROXY'] = 'true'
        self.assertEqual(proxy_fix_hops(), 1)

    def test_describe_platform_reports_the_policy(self):
        os.environ['DEPLOYMENT_PLATFORM'] = 'cloud-run'
        summary = describe_platform()
        self.assertIn('platform=cloud-run', summary)
        self.assertIn('proxyHops=1', summary)
        self.assertIn('edgeHeader=none', summary)


class GatewayForwardedIp(EnvTestCase):
    def setUp(self):
        super(GatewayForwardedIp, self).setUp()
        os.environ['DEPLOYMENT_PLATFORM'] = 'cloud-run'

    def test_accepted_when_the_secret_matches(self):
        req = FakeRequest({
            'x-internal-auth': SECRET,
            'x-real-client-ip': '198.51.100.7',
        })
        ip, source = resolve_client_ip(req, remote_addr())
        self.assertEqual(ip, '198.51.100.7')
        self.assertEqual(source, 'gateway')
        self.assertEqual(
            client_identity_key(req, remote_addr()), 'gw:198.51.100.7'
        )

    def test_ignored_without_the_secret(self):
        req = FakeRequest({'x-real-client-ip': '198.51.100.7'})
        ip, source = resolve_client_ip(req, remote_addr())
        self.assertEqual(ip, '10.0.0.1')
        self.assertEqual(source, 'socket')

    def test_ignored_with_a_wrong_secret(self):
        req = FakeRequest({
            'x-internal-auth': 'wrong-secret',
            'x-real-client-ip': '198.51.100.7',
        })
        self.assertEqual(resolve_client_ip(req, remote_addr())[0], '10.0.0.1')

    def test_ignored_with_a_same_length_wrong_secret(self):
        # Exercises the constant-time comparison rather than a length
        # short-circuit.
        req = FakeRequest({
            'x-internal-auth': 'x' * len(SECRET),
            'x-real-client-ip': '198.51.100.7',
        })
        self.assertEqual(resolve_client_ip(req, remote_addr())[0], '10.0.0.1')

    def test_ignored_when_the_service_has_no_secret_configured(self):
        os.environ.pop('INTERNAL_AUTH_SECRET')
        req = FakeRequest({
            'x-internal-auth': SECRET,
            'x-real-client-ip': '198.51.100.7',
        })
        self.assertEqual(resolve_client_ip(req, remote_addr())[0], '10.0.0.1')

    def test_has_internal_auth_cases(self):
        self.assertFalse(has_internal_auth(FakeRequest({})))
        self.assertFalse(has_internal_auth(FakeRequest({'x-internal-auth': ''})))
        self.assertFalse(has_internal_auth(FakeRequest({'x-internal-auth': 'no'})))
        self.assertTrue(has_internal_auth(FakeRequest({'x-internal-auth': SECRET})))


class EdgeHeaderIsOptIn(EnvTestCase):
    def test_honoured_on_render(self):
        os.environ['DEPLOYMENT_PLATFORM'] = 'render'
        req = FakeRequest({'cf-connecting-ip': '203.0.113.55'})
        ip, source = resolve_client_ip(req, remote_addr())
        self.assertEqual(ip, '203.0.113.55')
        self.assertEqual(source, 'edge')

    def test_not_honoured_on_cloud_run(self):
        # Nothing strips CF-Connecting-IP on Cloud Run, so trusting it would
        # hand a fresh rate-limit bucket to anyone who sets the header.
        os.environ['DEPLOYMENT_PLATFORM'] = 'cloud-run'
        req = FakeRequest({'cf-connecting-ip': '203.0.113.55'})
        self.assertEqual(resolve_client_ip(req, remote_addr())[0], '10.0.0.1')

    def test_not_honoured_locally(self):
        os.environ['DEPLOYMENT_PLATFORM'] = 'local'
        req = FakeRequest({'cf-connecting-ip': '203.0.113.55'})
        self.assertEqual(resolve_client_ip(req, remote_addr())[0], '10.0.0.1')

    def test_authenticated_gateway_ip_outranks_the_edge_header(self):
        os.environ['DEPLOYMENT_PLATFORM'] = 'render'
        req = FakeRequest({
            'x-internal-auth': SECRET,
            'x-real-client-ip': '198.51.100.7',
            'cf-connecting-ip': '203.0.113.55',
        })
        self.assertEqual(resolve_client_ip(req, remote_addr())[0], '198.51.100.7')


class IdentityDistinctness(EnvTestCase):
    def setUp(self):
        super(IdentityDistinctness, self).setUp()
        os.environ['DEPLOYMENT_PLATFORM'] = 'cloud-run'

    def test_distinct_ipv4_callers_stay_distinct(self):
        a = client_identity_key(FakeRequest({}), remote_addr('198.51.100.1'))
        b = client_identity_key(FakeRequest({}), remote_addr('198.51.100.2'))
        self.assertNotEqual(a, b)
        self.assertEqual(a, '198.51.100.1')

    def test_gateway_identities_are_namespaced_from_direct_callers(self):
        # A direct caller must never land in a proxied shopper's bucket.
        via_gateway = client_identity_key(
            FakeRequest({
                'x-internal-auth': SECRET,
                'x-real-client-ip': '198.51.100.9',
            }),
            remote_addr(),
        )
        direct = client_identity_key(FakeRequest({}), remote_addr('198.51.100.9'))
        self.assertEqual(via_gateway, 'gw:198.51.100.9')
        self.assertEqual(direct, '198.51.100.9')
        self.assertNotEqual(via_gateway, direct)

    def test_missing_remote_address_does_not_yield_an_empty_key(self):
        key = client_identity_key(FakeRequest({}), lambda: None)
        self.assertEqual(key, 'unknown')


if __name__ == '__main__':
    unittest.main()
