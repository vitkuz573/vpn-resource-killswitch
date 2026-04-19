from __future__ import annotations

import json
import os
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .constants import CONFIG_PATH, CONFIG_VERSION, DEFAULT_PROFILE_NAME, STATE_PATH
from .errors import CLIError
from .models import AppConfig, ResourcePolicy, ResourceProfile, VpnContext
from .network import normalize_country_codes, normalize_keywords


def _resource_from_dict(raw: dict[str, Any]) -> ResourceProfile:
    policy_raw = raw.get("policy") or {}
    policy = ResourcePolicy(
        required_country=policy_raw.get("required_country"),
        required_server=policy_raw.get("required_server"),
        allowed_countries=normalize_country_codes(policy_raw.get("allowed_countries")),
        blocked_countries=normalize_country_codes(policy_raw.get("blocked_countries")),
        blocked_context_keywords=normalize_keywords(policy_raw.get("blocked_context_keywords")),
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


def _atomic_write_json(path: Path, payload: dict[str, Any], *, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.tmp-{os.getpid()}-{os.urandom(4).hex()}")
    text = json.dumps(payload, indent=2) + "\n"
    temp_path.write_text(text, encoding="utf-8")
    temp_path.chmod(mode)
    temp_path.replace(path)


def save_config(config: AppConfig) -> None:
    payload = {
        "version": CONFIG_VERSION,
        "vpn_interface": config.vpn_interface,
        "resources": [asdict(resource) for resource in config.resources],
    }
    _atomic_write_json(CONFIG_PATH, payload, mode=0o644)


def _parse_json_best_effort(raw: str) -> dict[str, Any] | None:
    if not raw.strip():
        return None

    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    # Recover the first valid JSON object when trailing bytes are present.
    decoder = json.JSONDecoder()
    start = raw.find("{")
    if start < 0:
        return None
    candidate = raw[start:]
    try:
        parsed, _ = decoder.raw_decode(candidate)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def load_state() -> dict[str, Any] | None:
    if not STATE_PATH.exists():
        return None
    raw = STATE_PATH.read_text(encoding="utf-8")
    return _parse_json_best_effort(raw)


def save_state(payload: dict[str, Any]) -> None:
    data = dict(payload)
    data["updated_at"] = datetime.now(UTC).isoformat()
    _atomic_write_json(STATE_PATH, data, mode=0o644)


def context_to_dict(context: VpnContext | None) -> dict[str, Any] | None:
    if context is None:
        return None
    return asdict(context)
