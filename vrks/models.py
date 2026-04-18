from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ResourcePolicy:
    required_country: str | None = None
    required_server: str | None = None
    allowed_countries: list[str] | None = None
    blocked_countries: list[str] | None = None
    blocked_context_keywords: list[str] | None = None


@dataclass
class ResourceProfile:
    name: str
    domains: list[str]
    policy: ResourcePolicy = field(default_factory=ResourcePolicy)
    enabled: bool = True


@dataclass
class AppConfig:
    version: int
    vpn_interface: str
    resources: list[ResourceProfile]


@dataclass
class VpnContext:
    ip: str | None = None
    country: str | None = None
    country_code: str | None = None
    region: str | None = None
    city: str | None = None
    isp: str | None = None
    org: str | None = None
    domain: str | None = None


@dataclass
class ProbeResult:
    interface: str
    returncode: int
    http_code: str
    stderr: str

    @property
    def reachable(self) -> bool:
        return self.returncode == 0 and self.http_code != "000"
