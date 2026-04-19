from __future__ import annotations

import socket
import unittest
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import URLError
from unittest import mock

from vrks.blockpage import _humanize_mode, _humanize_reason
from vrks.discovery import discover_domains
from vrks.errors import CLIError
from vrks.firewall import build_nft_rules
from vrks.models import AppConfig, ResourcePolicy, ResourceProfile, VpnContext
from vrks.network import normalize_domain, normalize_domains, resolve_domains
from vrks.openai_country_sync import (
    OpenAISupportedCountriesSnapshot,
    extract_openai_supported_country_names,
    map_openai_country_names_to_codes,
)
from vrks.presets import get_preset, list_presets, upsert_user_preset
from vrks.service import KillSwitchService, _build_transition_events, _policy_match
from vrks import storage
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
        self.assertIn("table ip vpn_resource_killswitch_nat", script)
        self.assertIn("type nat hook output", script)
        self.assertIn("tcp dport 80 redirect", script)
        self.assertIn("tcp dport 443 redirect", script)


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


class OpenAICountrySyncTests(unittest.TestCase):
    def test_extract_openai_supported_country_names(self) -> None:
        html = """
        <html><body>
          <article id="mainContent">
            <ul>
              <li>United States of America</li>
              <li>Germany</li>
              <li>Germany</li>
            </ul>
          </article>
        </body></html>
        """
        self.assertEqual(
            extract_openai_supported_country_names(html),
            ["United States of America", "Germany"],
        )

    def test_map_openai_country_names_to_codes_with_unmapped(self) -> None:
        codes, unmapped = map_openai_country_names_to_codes(["United States of America", "Narnia"])
        self.assertEqual(codes, ["US"])
        self.assertEqual(unmapped, ["Narnia"])


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


class NotificationEventTests(unittest.TestCase):
    def test_build_transition_events_hard_block_and_restore(self) -> None:
        first = _build_transition_events(
            previous_resources={},
            current_resources={"svc": {"mode": "hard_block", "reason": "country_not_allowed"}},
            vpn_interface="amn0",
            previous_vpn_up=True,
            current_vpn_up=True,
        )
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0]["kind"], "resource_hard_block")
        self.assertEqual(first[0]["resource"], "svc")

        second = _build_transition_events(
            previous_resources={"svc": {"mode": "hard_block"}},
            current_resources={"svc": {"mode": "vpn_only", "reason": "policy_match"}},
            vpn_interface="amn0",
            previous_vpn_up=True,
            current_vpn_up=True,
        )
        self.assertEqual(len(second), 1)
        self.assertEqual(second[0]["kind"], "resource_vpn_only_restored")

    def test_build_transition_events_vpn_down_up(self) -> None:
        down = _build_transition_events(
            previous_resources={},
            current_resources={},
            vpn_interface="amn0",
            previous_vpn_up=True,
            current_vpn_up=False,
        )
        self.assertEqual(len(down), 1)
        self.assertEqual(down[0]["kind"], "vpn_down")

        up = _build_transition_events(
            previous_resources={},
            current_resources={},
            vpn_interface="amn0",
            previous_vpn_up=False,
            current_vpn_up=True,
        )
        self.assertEqual(len(up), 1)
        self.assertEqual(up[0]["kind"], "vpn_up")


class PresetTests(unittest.TestCase):
    def test_preset_catalog_has_builtins(self) -> None:
        names = [item.name for item in list_presets()]
        self.assertIn("antigravity", names)
        self.assertIn("chatgpt", names)

    def test_get_preset_antigravity_contains_domains(self) -> None:
        preset = get_preset("antigravity")
        self.assertTrue(len(preset.domains) >= 2)

    def test_get_preset_chatgpt_contains_expected_domains(self) -> None:
        preset = get_preset("chatgpt")
        self.assertIn("chatgpt.com", preset.domains)
        self.assertIn("api.openai.com", preset.domains)
        self.assertIn("developers.openai.com", preset.domains)
        self.assertIn("status.openai.com", preset.domains)
        self.assertIn("US", preset.policy["allowed_countries"])
        self.assertNotIn("RU", preset.policy["allowed_countries"])
        self.assertGreaterEqual(len(preset.policy["allowed_countries"]), 150)


class PresetOpenAISyncServiceTests(unittest.TestCase):
    @mock.patch("vrks.service.ensure_root")
    @mock.patch("vrks.service.fetch_openai_supported_country_snapshot")
    def test_sync_openai_supported_countries_updates_user_preset(
        self, mocked_fetch: mock.Mock, mocked_root: mock.Mock
    ) -> None:
        _ = mocked_root
        with TemporaryDirectory() as tmp:
            user_presets = Path(tmp) / "presets.json"
            with mock.patch("vrks.presets.USER_PRESETS_PATH", user_presets):
                mocked_fetch.return_value = OpenAISupportedCountriesSnapshot(
                    source_url="https://developers.openai.com/api/docs/supported-countries",
                    fetched_at="2026-04-19T12:00:00+00:00",
                    html_sha256="abc123",
                    country_names=["United States of America", "Germany"],
                    country_codes=["US", "DE"],
                )
                report = KillSwitchService().sync_openai_supported_countries(
                    preset_name="chatgpt",
                    force=True,
                    min_interval_hours=24,
                    apply_resource=False,
                    run_apply=False,
                    timeout=10,
                )
                self.assertFalse(report["skipped"])
                self.assertEqual(report["new_allowed_count"], 2)
                self.assertTrue(report["preset_changed"])
                self.assertEqual(report["added_countries"], [])
                self.assertGreater(len(report["removed_countries"]), 10)

                preset = get_preset("chatgpt")
                self.assertEqual(preset.policy["allowed_countries"], ["DE", "US"])

    @mock.patch("vrks.service.ensure_root")
    @mock.patch("vrks.service.fetch_openai_supported_country_snapshot")
    def test_sync_openai_supported_countries_respects_interval(
        self, mocked_fetch: mock.Mock, mocked_root: mock.Mock
    ) -> None:
        _ = mocked_root
        with TemporaryDirectory() as tmp:
            user_presets = Path(tmp) / "presets.json"
            with mock.patch("vrks.presets.USER_PRESETS_PATH", user_presets):
                preset = get_preset("chatgpt")
                upsert_user_preset(
                    {
                        "name": "chatgpt",
                        "description": preset.description,
                        "domains": preset.domains,
                        "policy": preset.policy,
                        "meta": {
                            "openai_country_sync": {
                                "last_synced_at": datetime.now(UTC).isoformat(),
                            }
                        },
                    }
                )

                report = KillSwitchService().sync_openai_supported_countries(
                    preset_name="chatgpt",
                    force=False,
                    min_interval_hours=24,
                    apply_resource=False,
                    run_apply=False,
                    timeout=10,
                )
                self.assertTrue(report["skipped"])
                self.assertEqual(report["skip_reason"], "interval_not_elapsed")
                mocked_fetch.assert_not_called()


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

    @mock.patch.object(KillSwitchService, "probe")
    def test_access_check_hard_block_accepts_451_block_page(self, mocked_probe: mock.Mock) -> None:
        mocked_probe.return_value = {
            "resource": "svc",
            "url": "https://blocked.example.com/",
            "expected_mode": "hard_block",
            "vpn_result": {"reachable": True, "blocked": True},
            "non_vpn_result": {"blocked": True},
            "passed": True,
        }

        report = KillSwitchService().access_check(
            resource_name="svc",
            domain="blocked.example.com",
            timeout=8,
            all_domains=False,
        )
        self.assertTrue(report["access_ok"])
        self.assertTrue(report["vpn_blocked"])


class BlockPageTextTests(unittest.TestCase):
    def test_humanize_mode(self) -> None:
        self.assertEqual(_humanize_mode("hard_block"), "hard_block: blocked on all interfaces")
        self.assertEqual(
            _humanize_mode("vpn_only"),
            "vpn_only: allowed only through VPN interface",
        )

    def test_humanize_reason_known_patterns(self) -> None:
        self.assertIn(
            "not in allowed_countries",
            _humanize_reason("country_not_allowed(current=US)"),
        )
        self.assertIn(
            "blocked keyword",
            _humanize_reason("context_keyword_blocked(keyword=crimea)"),
        )
        self.assertIn(
            "Policy trigger",
            _humanize_reason("custom_reason_value"),
        )


class StorageTests(unittest.TestCase):
    def test_load_state_recovers_first_json_object_on_trailing_bytes(self) -> None:
        with TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "state.json"
            state_path.write_text('{"vpn_interface":"amn0","vpn_up":true}\n}{broken', encoding="utf-8")
            with mock.patch("vrks.storage.STATE_PATH", state_path):
                loaded = storage.load_state()
        self.assertEqual(loaded, {"vpn_interface": "amn0", "vpn_up": True})

    def test_load_state_returns_none_for_unrecoverable_json(self) -> None:
        with TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "state.json"
            state_path.write_text("not json at all", encoding="utf-8")
            with mock.patch("vrks.storage.STATE_PATH", state_path):
                loaded = storage.load_state()
        self.assertIsNone(loaded)


if __name__ == "__main__":
    unittest.main()
