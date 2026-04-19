from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .errors import CLIError
from .mitm_ca import ensure_local_ca, local_ca_status, trust_local_ca
from .service import KillSwitchService


class ResourceUpsertRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=64)
    domains: list[str] = Field(..., min_length=1)
    required_country: str | None = None
    required_server: str | None = None
    allowed_countries: list[str] | None = None
    blocked_countries: list[str] | None = None
    blocked_context_keywords: list[str] | None = None
    replace: bool = False
    run_apply: bool = True


class ProbeRequest(BaseModel):
    resource_name: str | None = None
    domain: str | None = None
    non_vpn_interface: str | None = None
    timeout: int = Field(default=8, ge=1, le=60)


class AccessCheckRequest(BaseModel):
    resource_name: str
    domain: str | None = None
    timeout: int = Field(default=8, ge=1, le=60)
    all_domains: bool = False


class VerifyRequest(BaseModel):
    resources: list[str] | None = None
    timeout: int = Field(default=8, ge=1, le=60)


class PresetApplyRequest(BaseModel):
    replace: bool = True
    run_apply: bool = True


class PresetOpenAICountrySyncRequest(BaseModel):
    force: bool = False
    min_interval_hours: int = Field(default=24, ge=0, le=24 * 30)
    apply_resource: bool = True
    run_apply: bool = False
    timeout: int = Field(default=20, ge=1, le=120)


class BootstrapRequest(BaseModel):
    preset_name: str
    vpn_interface: str | None = None
    install_bin: bool = False
    timeout: int = Field(default=8, ge=1, le=60)
    autodiscover: bool = True
    discovery_depth: int = Field(default=2, ge=0, le=5)
    include_external: bool = False


class DiscoverRequest(BaseModel):
    resource_name: str | None = None
    preset_name: str | None = None
    max_depth: int = Field(default=2, ge=0, le=5)
    include_external: bool = False
    dns_check: bool = True


class AutofillRequest(BaseModel):
    max_depth: int = Field(default=2, ge=0, le=5)
    include_external: bool = False
    dns_check: bool = True
    run_apply: bool = True


class SyncRequest(BaseModel):
    resources: list[str] | None = None
    max_depth: int = Field(default=2, ge=0, le=5)
    include_external: bool = False
    dns_check: bool = True
    run_apply: bool = True
    verify_timeout: int = Field(default=8, ge=1, le=60)
    check_access: bool = True
    access_timeout: int = Field(default=8, ge=1, le=60)
    access_all_domains: bool = False


class RuntimeDiscoverRequest(BaseModel):
    command: str = Field(..., min_length=1)
    command_user: str | None = None
    duration: int = Field(default=60, ge=5, le=1800)
    startup_delay: float = Field(default=2.0, ge=0, le=300)
    capture_interface: str = "any"
    include_patterns: list[str] | None = None
    exclude_patterns: list[str] | None = None


class RuntimeAutofillRequest(BaseModel):
    command: str = Field(..., min_length=1)
    command_user: str | None = None
    duration: int = Field(default=60, ge=5, le=1800)
    startup_delay: float = Field(default=2.0, ge=0, le=300)
    capture_interface: str = "any"
    include_patterns: list[str] | None = None
    exclude_patterns: list[str] | None = None
    run_apply: bool = True


class SetupRequest(BaseModel):
    vpn_interface: str | None = None
    resource_name: str | None = None
    domains: list[str] | None = None
    required_country: str | None = None
    required_server: str | None = None
    allowed_countries: list[str] | None = None
    blocked_countries: list[str] | None = None
    blocked_context_keywords: list[str] | None = None
    install_bin: bool = False


class MitmCaInitRequest(BaseModel):
    common_name: str = Field(default="VRKS Local MITM CA", min_length=1, max_length=120)


def _serialize_status(service: KillSwitchService, status: dict[str, Any]) -> dict[str, Any]:
    return {
        "config": asdict(status["config"]),
        "vpn_up": status["vpn_up"],
        "nft_table_present": status["nft_table_present"],
        "nft_nat_table_present": status["nft_nat_table_present"],
        "timer_enabled": status["timer_enabled"],
        "timer_active": status["timer_active"],
        "watch_enabled": status["watch_enabled"],
        "watch_active": status["watch_active"],
        "blockpage_enabled": status["blockpage_enabled"],
        "blockpage_active": status["blockpage_active"],
        "tls_blockpage_enabled": status["tls_blockpage_enabled"],
        "tls_blockpage_active": status["tls_blockpage_active"],
        "local_ca": status["local_ca"],
        "state": status["state"],
        "resources": service.list_resources(),
    }


def create_app(service: KillSwitchService | None = None) -> FastAPI:
    svc = service or KillSwitchService()
    app = FastAPI(
        title="VPN Resource Kill-Switch API",
        description="REST API for managing VPN resource kill-switch policies and checks.",
        version="1.6.0",
    )

    def _run(handler):
        try:
            return handler()
        except CLIError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/v1/status")
    def status() -> dict[str, Any]:
        return _run(lambda: _serialize_status(svc, svc.status()))

    @app.post("/v1/setup")
    def setup(payload: SetupRequest) -> dict[str, Any]:
        return _run(
            lambda: svc.setup(
                vpn_interface=payload.vpn_interface,
                resource_name=payload.resource_name,
                domains=payload.domains,
                required_country=payload.required_country,
                required_server=payload.required_server,
                allowed_countries=payload.allowed_countries,
                blocked_countries=payload.blocked_countries,
                blocked_context_keywords=payload.blocked_context_keywords,
                install_bin=payload.install_bin,
            )
        )

    @app.post("/v1/bootstrap")
    def bootstrap(payload: BootstrapRequest) -> dict[str, Any]:
        return _run(
            lambda: svc.bootstrap(
                preset_name=payload.preset_name,
                vpn_interface=payload.vpn_interface,
                install_bin=payload.install_bin,
                timeout=payload.timeout,
                autodiscover=payload.autodiscover,
                discovery_depth=payload.discovery_depth,
                include_external=payload.include_external,
            )
        )

    @app.get("/v1/presets")
    def presets() -> list[dict[str, Any]]:
        return _run(svc.list_presets)

    @app.post("/v1/presets/{name}/apply")
    def apply_preset(name: str, payload: PresetApplyRequest) -> dict[str, Any]:
        return _run(lambda: svc.apply_preset(name=name, replace=payload.replace, run_apply=payload.run_apply))

    @app.post("/v1/presets/{name}/sync-openai-countries")
    def sync_openai_countries(name: str, payload: PresetOpenAICountrySyncRequest) -> dict[str, Any]:
        return _run(
            lambda: svc.sync_openai_supported_countries(
                preset_name=name,
                force=payload.force,
                min_interval_hours=payload.min_interval_hours,
                apply_resource=payload.apply_resource,
                run_apply=payload.run_apply,
                timeout=payload.timeout,
            )
        )

    @app.post("/v1/discover")
    def discover(payload: DiscoverRequest) -> dict[str, Any]:
        def _handler():
            if bool(payload.resource_name) == bool(payload.preset_name):
                raise CLIError("Set exactly one of resource_name or preset_name.")
            if payload.resource_name:
                return svc.discover_resource_domains(
                    resource_name=payload.resource_name,
                    max_depth=payload.max_depth,
                    include_external=payload.include_external,
                    dns_check=payload.dns_check,
                )
            return svc.discover_preset_domains(
                preset_name=str(payload.preset_name),
                max_depth=payload.max_depth,
                include_external=payload.include_external,
                dns_check=payload.dns_check,
            )

        return _run(_handler)

    @app.post("/v1/resources/{name}/autofill")
    def resource_autofill(name: str, payload: AutofillRequest) -> dict[str, Any]:
        return _run(
            lambda: svc.autofill_resource_domains(
                resource_name=name,
                max_depth=payload.max_depth,
                include_external=payload.include_external,
                dns_check=payload.dns_check,
                run_apply=payload.run_apply,
            )
        )

    @app.post("/v1/sync")
    def sync(payload: SyncRequest) -> dict[str, Any]:
        return _run(
            lambda: svc.sync(
                resources=payload.resources,
                max_depth=payload.max_depth,
                include_external=payload.include_external,
                dns_check=payload.dns_check,
                run_apply=payload.run_apply,
                verify_timeout=payload.verify_timeout,
                check_access=payload.check_access,
                access_timeout=payload.access_timeout,
                access_all_domains=payload.access_all_domains,
            )
        )

    @app.post("/v1/runtime/discover")
    def runtime_discover(payload: RuntimeDiscoverRequest) -> dict[str, Any]:
        return _run(
            lambda: svc.runtime_discover(
                command=payload.command,
                command_user=payload.command_user,
                duration=payload.duration,
                startup_delay=payload.startup_delay,
                capture_interface=payload.capture_interface,
                include_patterns=payload.include_patterns,
                exclude_patterns=payload.exclude_patterns,
            )
        )

    @app.post("/v1/resources/{name}/runtime-autofill")
    def runtime_autofill(name: str, payload: RuntimeAutofillRequest) -> dict[str, Any]:
        return _run(
            lambda: svc.runtime_autofill_resource(
                resource_name=name,
                command=payload.command,
                command_user=payload.command_user,
                duration=payload.duration,
                startup_delay=payload.startup_delay,
                capture_interface=payload.capture_interface,
                include_patterns=payload.include_patterns,
                exclude_patterns=payload.exclude_patterns,
                run_apply=payload.run_apply,
            )
        )

    @app.get("/v1/resources")
    def list_resources() -> list[dict[str, Any]]:
        return _run(svc.list_resources)

    @app.post("/v1/resources")
    def upsert_resource(payload: ResourceUpsertRequest) -> dict[str, Any]:
        def _handler():
            cfg = svc.add_resource(
                name=payload.name,
                domains=payload.domains,
                required_country=payload.required_country,
                required_server=payload.required_server,
                allowed_countries=payload.allowed_countries,
                blocked_countries=payload.blocked_countries,
                blocked_context_keywords=payload.blocked_context_keywords,
                replace=payload.replace,
            )
            apply_report = svc.apply() if payload.run_apply else None
            return {"resources_total": len(cfg.resources), "apply_report": apply_report}

        return _run(_handler)

    @app.delete("/v1/resources/{name}")
    def delete_resource(name: str) -> dict[str, Any]:
        def _handler():
            cfg = svc.remove_resource(name)
            return {"resources_total": len(cfg.resources)}

        return _run(_handler)

    @app.post("/v1/apply")
    def apply_rules() -> dict[str, Any]:
        return _run(svc.apply)

    @app.post("/v1/probe")
    def probe(payload: ProbeRequest) -> dict[str, Any]:
        return _run(
            lambda: svc.probe(
                resource_name=payload.resource_name,
                domain=payload.domain,
                non_vpn_interface=payload.non_vpn_interface,
                timeout=payload.timeout,
            )
        )

    @app.post("/v1/access-check")
    def access_check(payload: AccessCheckRequest) -> dict[str, Any]:
        return _run(
            lambda: svc.access_check(
                resource_name=payload.resource_name,
                domain=payload.domain,
                timeout=payload.timeout,
                all_domains=payload.all_domains,
            )
        )

    @app.post("/v1/verify")
    def verify(payload: VerifyRequest) -> dict[str, Any]:
        return _run(lambda: svc.verify(resources=payload.resources, timeout=payload.timeout))

    @app.post("/v1/disable")
    def disable() -> dict[str, Any]:
        def _handler():
            svc.disable()
            return {"ok": True}

        return _run(_handler)

    @app.get("/v1/mitm/ca-status")
    def mitm_ca_status() -> dict[str, Any]:
        return _run(local_ca_status)

    @app.post("/v1/mitm/ca-init")
    def mitm_ca_init(payload: MitmCaInitRequest) -> dict[str, Any]:
        return _run(lambda: ensure_local_ca(common_name=payload.common_name))

    @app.post("/v1/mitm/ca-trust")
    def mitm_ca_trust() -> dict[str, Any]:
        return _run(trust_local_ca)

    return app


def run_api_server(*, host: str, port: int) -> None:
    import uvicorn

    app = create_app()
    uvicorn.run(app, host=host, port=port, log_level="info")
