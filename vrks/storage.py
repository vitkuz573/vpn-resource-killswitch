from __future__ import annotations

import json
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from .constants import CONFIG_PATH, CONFIG_VERSION, DEFAULT_PROFILE_NAME, STATE_PATH
from .errors import CLIError
from .models import AppConfig, ResourcePolicy, ResourceProfile, VpnContext


def _resource_from_dict(raw: dict[str, Any]) -> ResourceProfile:
    policy_raw = raw.get("policy") or {}
    policy = ResourcePolicy(
        required_country=policy_raw.get("required_country"),
        required_server=policy_raw.get("required_server"),
    )
    return ResourceProfile(
        name=str(raw["name"]),
        domains=[str(x) for x in raw["domains"]],
        policy=policy,
        enabled=bool(raw.get("enabled", True)),
    )


def load_config() -> AppConfig:
    if not CONFIG_PATH.exists():
        raise CLIError(
            f"Config not found at {CONFIG_PATH}. Run setup first (`sudo vrks.py setup`)."
        )
    raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    version = int(raw.get("version", 1))
    vpn_interface = str(raw["vpn_interface"])

    # Backward compatibility: old format with top-level domains list.
    if "resources" not in raw and "domains" in raw:
        resources = [
            ResourceProfile(
                name=DEFAULT_PROFILE_NAME,
                domains=[str(x) for x in raw["domains"]],
            )
        ]
    else:
        resources = [_resource_from_dict(item) for item in raw.get("resources", [])]

    if not resources:
        raise CLIError("Config has no resources.")
    return AppConfig(version=version, vpn_interface=vpn_interface, resources=resources)


def save_config(config: AppConfig) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": CONFIG_VERSION,
        "vpn_interface": config.vpn_interface,
        "resources": [asdict(resource) for resource in config.resources],
    }
    CONFIG_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    CONFIG_PATH.chmod(0o644)


def load_state() -> dict[str, Any] | None:
    if not STATE_PATH.exists():
        return None
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def save_state(payload: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    data = dict(payload)
    data["updated_at"] = datetime.now(UTC).isoformat()
    STATE_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    STATE_PATH.chmod(0o644)


def context_to_dict(context: VpnContext | None) -> dict[str, Any] | None:
    if context is None:
        return None
    return asdict(context)
