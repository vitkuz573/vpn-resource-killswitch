from __future__ import annotations

import socket
import unittest
from unittest import mock

from vrks.errors import CLIError
from vrks.firewall import build_nft_rules
from vrks.models import ResourcePolicy, VpnContext
from vrks.network import normalize_domain, normalize_domains, resolve_domains
from vrks.service import _policy_match


class DomainNormalizeTests(unittest.TestCase):
    def test_normalize_domains_deduplicates_and_lowercases(self) -> None:
        got = normalize_domains(["MRDOOB.COM", "mrdoob.com.", "elgoog.im"])
        self.assertEqual(got, ["elgoog.im", "mrdoob.com"])

    def test_empty_domain_raises(self) -> None:
        with self.assertRaises(CLIError):
            normalize_domain(" ")


class NftBuildTests(unittest.TestCase):
    def test_build_nft_contains_expected_rule(self) -> None:
        script = build_nft_rules(
            vpn_interface="amn0",
            vpn_only_v4={"1.1.1.1"},
            vpn_only_v6={"2606:4700:4700::1111"},
            hard_block_v4={"2.2.2.2"},
            hard_block_v6={"2001:4860:4860::8888"},
        )
        self.assertIn('oifname != "amn0"', script)
        self.assertIn("set vpn_only_v4", script)
        self.assertIn("set hard_block_v4", script)


class ResolveTests(unittest.TestCase):
    @mock.patch("socket.getaddrinfo")
    def test_resolve_domains_splits_v4_and_v6(self, mocked_getaddrinfo: mock.Mock) -> None:
        mocked_getaddrinfo.return_value = [
            (socket.AF_INET, 0, 0, "", ("93.184.216.34", 0)),
            (socket.AF_INET6, 0, 0, "", ("2606:2800:220:1:248:1893:25c8:1946", 0)),
        ]
        ipv4, ipv6, failures = resolve_domains(["example.com"])
        self.assertEqual(ipv4, {"93.184.216.34"})
        self.assertEqual(ipv6, {"2606:2800:220:1:248:1893:25c8:1946"})
        self.assertEqual(failures, [])


class PolicyTests(unittest.TestCase):
    def test_country_policy_matches_country_code(self) -> None:
        policy = ResourcePolicy(required_country="US")
        context = VpnContext(country="United States", country_code="US")
        allowed, reason = _policy_match(policy, context)
        self.assertTrue(allowed)
        self.assertEqual(reason, "policy_match")

    def test_policy_blocks_on_mismatch(self) -> None:
        policy = ResourcePolicy(required_country="DE", required_server="m247")
        context = VpnContext(country="France", country_code="FR", isp="Cogent")
        allowed, reason = _policy_match(policy, context)
        self.assertFalse(allowed)
        self.assertIn("country_mismatch", reason)

    def test_policy_blocks_country_from_blocklist(self) -> None:
        policy = ResourcePolicy(blocked_countries=["RU", "IR", "KP"])
        context = VpnContext(country="Russia", country_code="RU")
        allowed, reason = _policy_match(policy, context)
        self.assertFalse(allowed)
        self.assertIn("country_blocked", reason)

    def test_policy_blocks_country_not_in_allowlist(self) -> None:
        policy = ResourcePolicy(allowed_countries=["US", "DE"])
        context = VpnContext(country="France", country_code="FR")
        allowed, reason = _policy_match(policy, context)
        self.assertFalse(allowed)
        self.assertIn("country_not_allowed", reason)

    def test_policy_allows_country_in_allowlist(self) -> None:
        policy = ResourcePolicy(allowed_countries=["US", "DE"])
        context = VpnContext(country="Germany", country_code="DE")
        allowed, reason = _policy_match(policy, context)
        self.assertTrue(allowed)
        self.assertEqual(reason, "policy_match")


if __name__ == "__main__":
    unittest.main()
