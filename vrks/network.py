from __future__ import annotations

import json
import re
import socket
from typing import Iterable

from .constants import GEO_LOOKUP_URL, IFNAME_RE, RESOURCE_RE
from .errors import CLIError
from .models import ProbeResult, VpnContext
from .system import run

COUNTRY_CODE_RE = re.compile(r"^[A-Za-z]{2}$")


def normalize_domain(domain: str) -> str:
    value = domain.strip().lower().rstrip(".")
    if not value:
        raise CLIError("Domain cannot be empty.")
    if len(value) > 253:
        raise CLIError(f"Domain too long: {value!r}")
    if any(ch.isspace() for ch in value):
        raise CLIError(f"Invalid domain: {value!r}")
    return value


def normalize_domains(domains: Iterable[str]) -> list[str]:
    values = sorted({normalize_domain(d) for d in domains})
    if not values:
        raise CLIError("At least one domain is required.")
    return values


def normalize_resource_name(name: str) -> str:
    value = name.strip().lower()
    if not RESOURCE_RE.match(value):
        raise CLIError(
            "Invalid resource name. Use lowercase letters/numbers/underscore/hyphen, 2-64 chars."
        )
    return value


def normalize_country_code(code: str) -> str:
    value = code.strip().upper()
    if not COUNTRY_CODE_RE.match(value):
        raise CLIError(f"Invalid country code: {code!r}. Use ISO 3166-1 alpha-2 like RU/US/DE.")
    return value


def normalize_country_codes(codes: Iterable[str] | None) -> list[str]:
    if not codes:
        return []
    return sorted({normalize_country_code(code) for code in codes})


def validate_ifname(ifname: str) -> str:
    value = ifname.strip()
    if not IFNAME_RE.match(value):
        raise CLIError(f"Invalid interface name: {ifname!r}")
    return value


def _iter_links_for_type(link_type: str) -> list[dict]:
    proc = run(["ip", "-j", "link", "show", "type", link_type], check=False)
    if proc.returncode != 0:
        return []
    return json.loads(proc.stdout or "[]")


def detect_vpn_interface() -> str | None:
    # Provider agnostic: first try explicit VPN link types.
    candidates: list[dict] = []
    for link_type in ("wireguard", "tun"):
        candidates.extend(_iter_links_for_type(link_type))

    # Fallback: interface naming patterns used by common VPN clients.
    if not candidates:
        proc = run(["ip", "-j", "link", "show"], check=False)
        rows = json.loads(proc.stdout or "[]") if proc.returncode == 0 else []
        for row in rows:
            name = str(row.get("ifname", ""))
            if name.startswith(("wg", "tun", "ppp", "vpn", "utun", "amn")):
                candidates.append(row)

    if not candidates:
        return None

    for row in candidates:
        flags = set(row.get("flags", []))
        if "UP" in flags:
            return str(row.get("ifname"))
    return str(candidates[0].get("ifname"))


def detect_non_vpn_interface(vpn_interface: str) -> str | None:
    proc = run(["ip", "-j", "route", "show", "default"], check=False)
    if proc.returncode != 0:
        return None
    routes = json.loads(proc.stdout or "[]")
    for route in routes:
        dev = route.get("dev")
        if dev and dev != vpn_interface:
            return str(dev)
    return None


def interface_is_up(ifname: str) -> bool:
    proc = run(["ip", "-j", "link", "show", "dev", ifname], check=False)
    if proc.returncode != 0:
        return False
    rows = json.loads(proc.stdout or "[]")
    if not rows:
        return False
    return "UP" in set(rows[0].get("flags", []))


def resolve_domains(domains: Iterable[str]) -> tuple[set[str], set[str], list[str]]:
    ipv4: set[str] = set()
    ipv6: set[str] = set()
    failures: list[str] = []
    for domain in domains:
        try:
            infos = socket.getaddrinfo(domain, None, type=socket.SOCK_STREAM)
        except socket.gaierror as exc:
            failures.append(f"{domain}: {exc}")
            continue
        for family, _, _, _, sockaddr in infos:
            addr = sockaddr[0]
            if family == socket.AF_INET:
                ipv4.add(addr)
            elif family == socket.AF_INET6:
                ipv6.add(addr)
    return ipv4, ipv6, failures


def detect_vpn_context(vpn_interface: str, timeout: int = 8) -> tuple[VpnContext | None, str | None]:
    proc = run(
        [
            "curl",
            "-m",
            str(timeout),
            "--interface",
            vpn_interface,
            "-sS",
            GEO_LOOKUP_URL,
        ],
        check=False,
    )
    if proc.returncode != 0:
        return None, (proc.stderr or "geo lookup failed").strip()

    try:
        data = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        return None, "geo lookup returned invalid json"

    if not data.get("success", True):
        return None, str(data.get("message") or "geo lookup failed")

    connection = data.get("connection") or {}
    ctx = VpnContext(
        ip=data.get("ip"),
        country=data.get("country"),
        country_code=data.get("country_code"),
        isp=connection.get("isp"),
        org=connection.get("org"),
        domain=connection.get("domain"),
    )
    return ctx, None


def probe_interface(url: str, ifname: str, timeout: int) -> ProbeResult:
    proc = run(
        [
            "curl",
            "-I",
            "-m",
            str(timeout),
            "--interface",
            ifname,
            "-sS",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            url,
        ],
        check=False,
    )
    return ProbeResult(
        interface=ifname,
        returncode=proc.returncode,
        http_code=(proc.stdout or "").strip() or "000",
        stderr=(proc.stderr or "").strip(),
    )
