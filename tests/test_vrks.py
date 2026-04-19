from __future__ import annotations

import socket
import unittest
from urllib.error import URLError
from unittest import mock

from vrks.discovery import discover_domains
from vrks.errors import CLIError
from vrks.firewall import build_nft_rules
from vrks.models import AppConfig, ResourcePolicy, ResourceProfile, VpnContext
from vrks.network import normalize_domain, normalize_domains, resolve_domains
from vrks.presets import get_preset, list_presets
from vrks.service import KillSwitchService, _policy_match
from vrks.traffic import extract_domains_from_capture, filter_domains, parse_command


class DomainNormalizeTests(unittest.TestCase):
    def test_normalize_domains_deduplicates_and_lowercases(self) -> None:
        got = normalize_domains(["Example.COM", "example.com.", "api.example.com"])
        self.assertEqual(got, ["api.example.com", "example.com"])

    def test_empty_domain_raises(self) -> None:
        with self.assertRaises(CLIError):
            normalize_domain(" ")

    def test_single_label_domain_raises(self) -> None:
        with self.assertRaises(CLIError):
            normalize_domain("localhost")

    def test_url_like_domain_raises(self) -> None:
        with self.assertRaises(CLIError):
            normalize_domain("https://example.com")


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


class _FakeResponse:
    def __init__(self, *, url: str, body: str | bytes, content_type: str) -> None:
        self._url = url
        self._body = body.encode("utf-8") if isinstance(body, str) else body
        self.headers = {"Content-Type": content_type}

    def geturl(self) -> str:
        return self._url

    def read(self, _size: int | None = None) -> bytes:
        return self._body

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class DiscoveryTests(unittest.TestCase):
    @mock.patch("vrks.discovery.urllib.request.urlopen")
    def test_discovery_ignores_invalid_domains_and_binary_links(self, mocked_urlopen: mock.Mock) -> None:
        responses = {
            "https://example.com/": _FakeResponse(
                url="https://example.com/",
                content_type="text/html",
                body="""
                  <a href="https://cdn.example.com/lib.js">cdn</a>
                  <a href="//api.example.com/v1">api</a>
                  <a href="https://www.google.com/track.js">google</a>
                  <a href="https://www/">bad</a>
                  <a href="https://ssl/">bad2</a>
                  <img src="/img/logo.png">
                """,
            ),
            "https://api.example.com/v1": _FakeResponse(
                url="https://api.example.com/v1",
                content_type="application/json",
                body='{"next":"https://assets.example.com/style.css"}',
            ),
            "https://cdn.example.com/lib.js": _FakeResponse(
                url="https://cdn.example.com/lib.js",
                content_type="application/javascript",
                body='const css = "https://static.example.com/a.css";',
            ),
        }

        def _urlopen(req, timeout=None, context=None):  # noqa: ANN001, ARG001
            _ = timeout, context
            url = req.full_url
            if url in responses:
                return responses[url]
            raise URLError(f"mock missing url {url}")

        mocked_urlopen.side_effect = _urlopen

        report = discover_domains(
            seed_domains=["example.com"],
            max_depth=1,
            include_external=False,
            dns_check=False,
        )

        self.assertEqual(
            report.domains,
            ["api.example.com", "assets.example.com", "cdn.example.com", "example.com", "static.example.com"],
        )
        self.assertEqual(report.external_domains, ["www.google.com"])
        self.assertNotIn("www", report.domains)
        self.assertNotIn("ssl", report.domains)
        self.assertFalse(any(url.endswith(".png") for url in report.crawled_urls))

    @mock.patch("vrks.discovery.socket.getaddrinfo")
    @mock.patch("vrks.discovery.urllib.request.urlopen")
    def test_discovery_dns_check_filters_unresolved_domains(
        self, mocked_urlopen: mock.Mock, mocked_getaddrinfo: mock.Mock
    ) -> None:
        mocked_urlopen.return_value = _FakeResponse(
            url="https://example.com/",
            content_type="text/html",
            body='<a href="https://a.example.com/">a</a>',
        )

        def _getaddrinfo(domain, *args, **kwargs):  # noqa: ANN001, ARG001
            _ = args, kwargs
            if domain == "example.com":
                return [(socket.AF_INET, 0, 0, "", ("93.184.216.34", 0))]
            raise socket.gaierror("not found")

        mocked_getaddrinfo.side_effect = _getaddrinfo

        report = discover_domains(
            seed_domains=["example.com"],
            max_depth=0,
            dns_check=True,
        )

        self.assertEqual(report.domains, ["example.com"])
        self.assertEqual(report.unresolved_domains, ["a.example.com"])


class RuntimeDiscoveryTests(unittest.TestCase):
    def test_extract_domains_from_capture_normalizes_and_ignores_local(self) -> None:
        capture = "\n".join(
            [
                "antigravity.google\t\t",
                "\tantigravity-unleash.goog\t",
                "\t\thttps://play.googleapis.com/path",
                "127.0.0.1:1234\tlocalhost:8080\t",
                "bad host\t\t",
            ]
        )
        domains, invalid, lines = extract_domains_from_capture(capture)
        self.assertEqual(lines, 5)
        self.assertEqual(domains, ["antigravity-unleash.goog", "antigravity.google", "play.googleapis.com"])
        self.assertIn("bad host", invalid)
        self.assertIn("127.0.0.1:1234", invalid)

    def test_filter_domains_include_and_exclude(self) -> None:
        domains = [
            "antigravity.google",
            "play.googleapis.com",
            "browser.events.data.microsoft.com",
        ]
        kept, excluded = filter_domains(
            domains,
            include_patterns=["antigravity|googleapis"],
            exclude_patterns=["microsoft\\.com"],
        )
        self.assertEqual(kept, ["antigravity.google", "play.googleapis.com"])
        self.assertIn("browser.events.data.microsoft.com", excluded)

    def test_parse_command_raises_on_empty(self) -> None:
        with self.assertRaises(CLIError):
            parse_command("   ")


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

    def test_policy_blocks_by_context_keyword(self) -> None:
        policy = ResourcePolicy(blocked_context_keywords=["crimea", "dnr"])
        context = VpnContext(
            country="Ukraine",
            country_code="UA",
            region="Crimea",
            city="Sevastopol",
        )
        allowed, reason = _policy_match(policy, context)
        self.assertFalse(allowed)
        self.assertIn("context_keyword_blocked", reason)


class PresetTests(unittest.TestCase):
    def test_preset_catalog_has_antigravity(self) -> None:
        names = [item.name for item in list_presets()]
        self.assertIn("antigravity", names)

    def test_get_preset_contains_domains(self) -> None:
        preset = get_preset("antigravity")
        self.assertTrue(len(preset.domains) >= 2)


class AccessCheckTests(unittest.TestCase):
    @mock.patch.object(KillSwitchService, "probe")
    @mock.patch("vrks.service.storage.load_config")
    def test_access_check_all_domains_aggregates_failures(
        self, mocked_load_config: mock.Mock, mocked_probe: mock.Mock
    ) -> None:
        mocked_load_config.return_value = AppConfig(
            version=3,
            vpn_interface="amn0",
            resources=[ResourceProfile(name="svc", domains=["a.example.com", "b.example.com"])],
        )
        mocked_probe.side_effect = [
            {
                "resource": "svc",
                "url": "https://a.example.com/",
                "expected_mode": "vpn_only",
                "vpn_result": {"reachable": True},
                "non_vpn_result": {"blocked": True},
            },
            {
                "resource": "svc",
                "url": "https://b.example.com/",
                "expected_mode": "vpn_only",
                "vpn_result": {"reachable": True},
                "non_vpn_result": {"blocked": False},
            },
        ]

        report = KillSwitchService().access_check(
            resource_name="svc",
            domain=None,
            timeout=8,
            all_domains=True,
        )
        self.assertFalse(report["access_ok"])
        self.assertEqual(report["domains_checked"], 2)
        self.assertEqual(report["failed_domains"], ["https://b.example.com/"])


if __name__ == "__main__":
    unittest.main()
