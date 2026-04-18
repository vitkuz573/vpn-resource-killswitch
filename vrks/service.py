from __future__ import annotations

import ipaddress
import shutil
import time
import sys
import subprocess
from pathlib import Path
from typing import Any

from . import storage
from .constants import (
    BIN_PATH,
    CONFIG_VERSION,
    DEFAULT_PROFILE_DOMAINS,
    DEFAULT_PROFILE_NAME,
    RUNTIME_ROOT,
    SERVICE_PATH,
    TIMER_NAME,
    TIMER_PATH,
    WATCH_SERVICE_NAME,
    WATCH_SERVICE_PATH,
)
from .errors import CLIError
from .firewall import apply_nft, delete_nft_table, nft_table_exists
from .models import AppConfig, ResourcePolicy, ResourceProfile, VpnContext
from .network import (
    detect_non_vpn_interface,
    detect_vpn_context,
    detect_vpn_interface,
    interface_is_up,
    normalize_country_codes,
    normalize_keywords,
    normalize_domain,
    normalize_domains,
    normalize_resource_name,
    probe_interface,
    resolve_domains,
    validate_ifname,
)
from .runtime import (
    disable_timer,
    enable_timer,
    install_nm_dispatcher_hook,
    install_runtime_tree,
    remove_nm_dispatcher_hook,
    write_systemd_units,
)
from .system import ensure_root, run


def _sorted_ips(values: set[str]) -> list[str]:
    return sorted(values, key=lambda x: ipaddress.ip_address(x))


def _has_policy(policy: ResourcePolicy) -> bool:
    return bool(
        (policy.required_country or "").strip()
        or (policy.required_server or "").strip()
        or normalize_country_codes(policy.allowed_countries)
        or normalize_country_codes(policy.blocked_countries)
        or normalize_keywords(policy.blocked_context_keywords)
    )


def _context_haystack(context: VpnContext) -> str:
    parts = [
        context.ip or "",
        context.country or "",
        context.country_code or "",
        context.region or "",
        context.city or "",
        context.isp or "",
        context.org or "",
        context.domain or "",
    ]
    return " ".join(parts).lower()


def _policy_match(policy: ResourcePolicy, context: VpnContext | None) -> tuple[bool, str]:
    need_country = (policy.required_country or "").strip()
    need_server = (policy.required_server or "").strip()
    allowed_countries = normalize_country_codes(policy.allowed_countries)
    blocked_countries = normalize_country_codes(policy.blocked_countries)
    blocked_keywords = normalize_keywords(policy.blocked_context_keywords)
    if (
        not need_country
        and not need_server
        and not allowed_countries
        and not blocked_countries
        and not blocked_keywords
    ):
        return True, "no_policy_constraints"

    if context is None:
        return False, "vpn_context_unavailable"

    current_country_code = (context.country_code or "").strip().upper()

    if blocked_countries:
        if not current_country_code:
            return False, "country_code_unavailable_for_blocked_policy"
        if current_country_code in set(blocked_countries):
            return False, f"country_blocked(current={current_country_code})"

    if blocked_keywords:
        haystack = _context_haystack(context)
        for keyword in blocked_keywords:
            if keyword in haystack:
                return False, f"context_keyword_blocked(keyword={keyword})"

    if allowed_countries:
        if not current_country_code:
            return False, "country_code_unavailable_for_allowed_policy"
        if current_country_code not in set(allowed_countries):
            return False, f"country_not_allowed(current={current_country_code})"

    if need_country:
        expected = need_country.lower()
        options = {
            (context.country or "").lower(),
            (context.country_code or "").lower(),
        }
        if expected not in options:
            return False, f"country_mismatch(expected={need_country})"

    if need_server:
        expected = need_server.lower()
        options = [
            (context.ip or "").lower(),
            (context.org or "").lower(),
            (context.isp or "").lower(),
            (context.domain or "").lower(),
        ]
        if not any(expected in value for value in options if value):
            return False, f"server_mismatch(expected~={need_server})"

    return True, "policy_match"


def _resource_by_name(config: AppConfig, name: str) -> ResourceProfile:
    target = normalize_resource_name(name)
    for resource in config.resources:
        if normalize_resource_name(resource.name) == target:
            return resource
    raise CLIError(f"Resource '{target}' not found.")


class KillSwitchService:
    def __init__(self, project_root: Path | None = None) -> None:
        self.project_root = project_root or Path(__file__).resolve().parents[1]

    def setup(
        self,
        *,
        vpn_interface: str | None,
        domains: list[str] | None,
        required_country: str | None,
        required_server: str | None,
        allowed_countries: list[str] | None,
        blocked_countries: list[str] | None,
        blocked_context_keywords: list[str] | None,
        install_bin: bool,
    ) -> dict[str, Any]:
        ensure_root()
        detected_if = vpn_interface or detect_vpn_interface()
        if not detected_if:
            raise CLIError("Cannot auto-detect VPN interface. Set --vpn-interface.")
        vpn_if = validate_ifname(detected_if)

        antigravity_domains = normalize_domains(domains or list(DEFAULT_PROFILE_DOMAINS))
        initial = ResourceProfile(
            name=DEFAULT_PROFILE_NAME,
            domains=antigravity_domains,
            policy=ResourcePolicy(
                required_country=(required_country or None),
                required_server=(required_server or None),
                allowed_countries=normalize_country_codes(allowed_countries),
                blocked_countries=normalize_country_codes(blocked_countries),
                blocked_context_keywords=normalize_keywords(blocked_context_keywords),
            ),
        )
        config = AppConfig(version=CONFIG_VERSION, vpn_interface=vpn_if, resources=[initial])
        storage.save_config(config)

        if install_bin:
            exec_path = str(install_runtime_tree(self.project_root))
        else:
            exec_path = f"{sys.executable} {(self.project_root / 'vrks.py').resolve()}"

        write_systemd_units(exec_path)
        install_nm_dispatcher_hook()
        enable_timer()

        report = self.apply(config=config)
        return {"config": config, "report": report}

    def apply(self, config: AppConfig | None = None) -> dict[str, Any]:
        ensure_root()
        current = config or storage.load_config()
        current.vpn_interface = validate_ifname(current.vpn_interface)

        previous_state = storage.load_state() or {}
        previous_resources = previous_state.get("resources") or {}

        needs_context = any(_has_policy(r.policy) for r in current.resources if r.enabled)
        context, context_error = (None, None)
        if needs_context:
            context, context_error = detect_vpn_context(current.vpn_interface)

        vpn_only_v4: set[str] = set()
        vpn_only_v6: set[str] = set()
        hard_block_v4: set[str] = set()
        hard_block_v6: set[str] = set()
        failures: list[str] = []
        resource_state: dict[str, Any] = {}

        for resource in current.resources:
            if not resource.enabled:
                continue
            name = normalize_resource_name(resource.name)
            domains = normalize_domains(resource.domains)
            ipv4, ipv6, resolve_failures = resolve_domains(domains)
            for failure in resolve_failures:
                failures.append(f"{name}: {failure}")

            if not ipv4 and not ipv6:
                cached = previous_resources.get(name, {})
                ipv4 = set(cached.get("ipv4", []))
                ipv6 = set(cached.get("ipv6", []))
                if ipv4 or ipv6:
                    failures.append(f"{name}: dns_empty_using_cached_ips")

            if not ipv4 and not ipv6:
                failures.append(f"{name}: no_addresses_resolved")
                continue

            allowed, reason = _policy_match(resource.policy, context)
            mode = "vpn_only" if allowed else "hard_block"

            if mode == "vpn_only":
                vpn_only_v4 |= ipv4
                vpn_only_v6 |= ipv6
            else:
                hard_block_v4 |= ipv4
                hard_block_v6 |= ipv6

            resource_state[name] = {
                "domains": domains,
                "policy": {
                    "required_country": resource.policy.required_country,
                    "required_server": resource.policy.required_server,
                    "allowed_countries": normalize_country_codes(resource.policy.allowed_countries),
                    "blocked_countries": normalize_country_codes(resource.policy.blocked_countries),
                    "blocked_context_keywords": normalize_keywords(
                        resource.policy.blocked_context_keywords
                    ),
                },
                "mode": mode,
                "reason": reason,
                "ipv4": _sorted_ips(ipv4),
                "ipv6": _sorted_ips(ipv6),
            }

        if not (vpn_only_v4 or vpn_only_v6 or hard_block_v4 or hard_block_v6):
            raise CLIError("No resolved targets to enforce. Check configured resources/domains.")

        apply_nft(
            vpn_interface=current.vpn_interface,
            vpn_only_v4=vpn_only_v4,
            vpn_only_v6=vpn_only_v6,
            hard_block_v4=hard_block_v4,
            hard_block_v6=hard_block_v6,
        )

        storage.save_state(
            {
                "vpn_interface": current.vpn_interface,
                "vpn_context": storage.context_to_dict(context),
                "vpn_context_error": context_error,
                "resources": resource_state,
                "failures": failures,
                "counts": {
                    "vpn_only_v4": len(vpn_only_v4),
                    "vpn_only_v6": len(vpn_only_v6),
                    "hard_block_v4": len(hard_block_v4),
                    "hard_block_v6": len(hard_block_v6),
                },
            }
        )

        return {
            "vpn_context": storage.context_to_dict(context),
            "vpn_context_error": context_error,
            "resource_state": resource_state,
            "failures": failures,
            "counts": {
                "vpn_only_v4": len(vpn_only_v4),
                "vpn_only_v6": len(vpn_only_v6),
                "hard_block_v4": len(hard_block_v4),
                "hard_block_v6": len(hard_block_v6),
            },
        }

    def status(self) -> dict[str, Any]:
        config = storage.load_config()
        state = storage.load_state()
        enabled = run(["systemctl", "is-enabled", TIMER_NAME], check=False).stdout.strip() or "unknown"
        active = run(["systemctl", "is-active", TIMER_NAME], check=False).stdout.strip() or "unknown"
        watch_enabled = (
            run(["systemctl", "is-enabled", WATCH_SERVICE_NAME], check=False).stdout.strip()
            or "unknown"
        )
        watch_active = (
            run(["systemctl", "is-active", WATCH_SERVICE_NAME], check=False).stdout.strip()
            or "unknown"
        )
        return {
            "config": config,
            "vpn_up": interface_is_up(config.vpn_interface),
            "nft_table_present": nft_table_exists(),
            "timer_enabled": enabled,
            "timer_active": active,
            "watch_enabled": watch_enabled,
            "watch_active": watch_active,
            "state": state,
        }

    def add_resource(
        self,
        *,
        name: str,
        domains: list[str],
        required_country: str | None,
        required_server: str | None,
        allowed_countries: list[str] | None,
        blocked_countries: list[str] | None,
        blocked_context_keywords: list[str] | None,
        replace: bool,
    ) -> AppConfig:
        ensure_root()
        config = storage.load_config()
        target = normalize_resource_name(name)
        normalized_domains = normalize_domains(domains)
        new_resource = ResourceProfile(
            name=target,
            domains=normalized_domains,
            policy=ResourcePolicy(
                required_country=(required_country or None),
                required_server=(required_server or None),
                allowed_countries=normalize_country_codes(allowed_countries),
                blocked_countries=normalize_country_codes(blocked_countries),
                blocked_context_keywords=normalize_keywords(blocked_context_keywords),
            ),
        )

        replaced = False
        for idx, current in enumerate(config.resources):
            if normalize_resource_name(current.name) == target:
                if not replace:
                    raise CLIError(f"Resource '{target}' already exists. Use --replace.")
                config.resources[idx] = new_resource
                replaced = True
                break

        if not replaced:
            config.resources.append(new_resource)
        storage.save_config(config)
        return config

    def remove_resource(self, name: str) -> AppConfig:
        ensure_root()
        config = storage.load_config()
        target = normalize_resource_name(name)
        kept = [r for r in config.resources if normalize_resource_name(r.name) != target]
        if len(kept) == len(config.resources):
            raise CLIError(f"Resource '{target}' not found.")
        if not kept:
            raise CLIError("Cannot remove last resource profile.")
        config.resources = kept
        storage.save_config(config)
        return config

    def list_resources(self) -> list[dict[str, Any]]:
        config = storage.load_config()
        result = []
        for resource in config.resources:
            result.append(
                {
                    "name": resource.name,
                    "domains": resource.domains,
                    "enabled": resource.enabled,
                    "policy": {
                        "required_country": resource.policy.required_country,
                        "required_server": resource.policy.required_server,
                        "allowed_countries": normalize_country_codes(resource.policy.allowed_countries),
                        "blocked_countries": normalize_country_codes(resource.policy.blocked_countries),
                        "blocked_context_keywords": normalize_keywords(
                            resource.policy.blocked_context_keywords
                        ),
                    },
                }
            )
        return result

    def probe(
        self,
        *,
        resource_name: str | None,
        domain: str | None,
        non_vpn_interface: str | None,
        timeout: int,
    ) -> dict[str, Any]:
        config = storage.load_config()
        resource = (
            _resource_by_name(config, resource_name)
            if resource_name
            else config.resources[0]
        )
        target_domain = normalize_domain(domain) if domain else normalize_domain(resource.domains[0])
        url = f"https://{target_domain}/"

        non_vpn = non_vpn_interface or detect_non_vpn_interface(config.vpn_interface)
        if not non_vpn:
            raise CLIError("Cannot detect non-VPN interface for probe.")

        vpn_res = probe_interface(url, config.vpn_interface, timeout)
        plain_res = probe_interface(url, non_vpn, timeout)

        expected_mode = "vpn_only"
        state = storage.load_state() or {}
        resource_state = (state.get("resources") or {}).get(normalize_resource_name(resource.name), {})
        if resource_state:
            expected_mode = str(resource_state.get("mode") or "vpn_only")

        non_vpn_blocked = plain_res.returncode != 0 or plain_res.http_code == "000"
        if expected_mode == "hard_block":
            passed = (not vpn_res.reachable) and non_vpn_blocked
        else:
            passed = vpn_res.reachable and non_vpn_blocked

        return {
            "resource": normalize_resource_name(resource.name),
            "url": url,
            "expected_mode": expected_mode,
            "vpn_result": {
                "interface": vpn_res.interface,
                "returncode": vpn_res.returncode,
                "http_code": vpn_res.http_code,
                "stderr": vpn_res.stderr,
                "reachable": vpn_res.reachable,
            },
            "non_vpn_result": {
                "interface": plain_res.interface,
                "returncode": plain_res.returncode,
                "http_code": plain_res.http_code,
                "stderr": plain_res.stderr,
                "blocked": non_vpn_blocked,
            },
            "passed": passed,
        }

    def verify(self, *, resources: list[str] | None, timeout: int) -> dict[str, Any]:
        status = self.status()
        config = status["config"]
        issues: list[str] = []
        probes: list[dict[str, Any]] = []

        if status["timer_enabled"] != "enabled":
            issues.append(f"timer_not_enabled({status['timer_enabled']})")
        if status["timer_active"] != "active":
            issues.append(f"timer_not_active({status['timer_active']})")
        if status["watch_enabled"] != "enabled":
            issues.append(f"watch_not_enabled({status['watch_enabled']})")
        if status["watch_active"] != "active":
            issues.append(f"watch_not_active({status['watch_active']})")
        if not status["nft_table_present"]:
            issues.append("nft_table_missing")
        if not status["vpn_up"]:
            issues.append("vpn_interface_down")

        wanted = {normalize_resource_name(item) for item in (resources or [])}
        selected = []
        for resource in config.resources:
            name = normalize_resource_name(resource.name)
            if wanted and name not in wanted:
                continue
            if not resource.enabled:
                continue
            selected.append(name)

        if wanted and not selected:
            raise CLIError("No requested resources found in config.")

        for name in selected:
            probe = self.probe(
                resource_name=name,
                domain=None,
                non_vpn_interface=None,
                timeout=timeout,
            )
            probes.append(probe)
            if not probe["passed"]:
                issues.append(f"probe_failed({name})")

        return {
            "passed": len(issues) == 0,
            "issues": issues,
            "checks": {
                "timer_enabled": status["timer_enabled"],
                "timer_active": status["timer_active"],
                "watch_enabled": status["watch_enabled"],
                "watch_active": status["watch_active"],
                "nft_table_present": status["nft_table_present"],
                "vpn_up": status["vpn_up"],
            },
            "probes": probes,
        }

    def watch(self, *, debounce_seconds: float = 1.0) -> int:
        ensure_root()
        last_apply_at = 0.0

        def _maybe_apply(trigger: str) -> None:
            nonlocal last_apply_at
            now = time.monotonic()
            if (now - last_apply_at) < debounce_seconds:
                return
            self.apply()
            last_apply_at = now
            print(f"[watch] rules refreshed: {trigger}", flush=True)

        _maybe_apply("startup")
        proc = subprocess.Popen(
            ["ip", "monitor", "link", "route", "address"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            text = line.strip()
            if not text:
                continue
            # Any route/address/link change can alter VPN path or DNS behavior.
            _maybe_apply(text)
        return proc.wait()

    def disable(self) -> None:
        ensure_root()
        delete_nft_table()

    def teardown(self, *, purge: bool, remove_bin: bool) -> None:
        ensure_root()
        delete_nft_table()
        disable_timer()
        remove_nm_dispatcher_hook()

        if SERVICE_PATH.exists():
            SERVICE_PATH.unlink()
        if TIMER_PATH.exists():
            TIMER_PATH.unlink()
        if WATCH_SERVICE_PATH.exists():
            WATCH_SERVICE_PATH.unlink()
        run(["systemctl", "daemon-reload"], check=False)

        if purge:
            if storage.CONFIG_PATH.exists():
                storage.CONFIG_PATH.unlink()
            if storage.STATE_PATH.exists():
                storage.STATE_PATH.unlink()
            if storage.CONFIG_PATH.parent.exists() and not any(storage.CONFIG_PATH.parent.iterdir()):
                storage.CONFIG_PATH.parent.rmdir()
            if storage.STATE_PATH.parent.exists() and not any(storage.STATE_PATH.parent.iterdir()):
                storage.STATE_PATH.parent.rmdir()

        if remove_bin and BIN_PATH.exists():
            BIN_PATH.unlink()
        if remove_bin and RUNTIME_ROOT.exists():
            shutil.rmtree(RUNTIME_ROOT)
