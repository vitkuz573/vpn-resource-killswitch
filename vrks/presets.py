from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .constants import CONFIG_DIR
from .errors import CLIError
from .network import normalize_country_codes, normalize_domains, normalize_keywords, normalize_resource_name


DEFAULT_PRESETS_PATH = Path(__file__).resolve().with_name("presets.default.json")
USER_PRESETS_PATH = CONFIG_DIR / "presets.json"


@dataclass
class Preset:
    name: str
    description: str
    domains: list[str]
    policy: dict[str, Any]


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise CLIError(f"Presets file not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CLIError(f"Invalid presets JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise CLIError(f"Invalid presets format in {path}: top-level object required.")
    return data


def _normalize_preset(raw: dict[str, Any]) -> Preset:
    name = normalize_resource_name(str(raw["name"]))
    description = str(raw.get("description") or "").strip() or "No description"
    domains = normalize_domains([str(x) for x in raw.get("domains", [])])
    policy_raw = raw.get("policy") or {}
    policy = {
        "required_country": (str(policy_raw.get("required_country")).strip() or None)
        if policy_raw.get("required_country") is not None
        else None,
        "required_server": (str(policy_raw.get("required_server")).strip() or None)
        if policy_raw.get("required_server") is not None
        else None,
        "allowed_countries": normalize_country_codes(policy_raw.get("allowed_countries")),
        "blocked_countries": normalize_country_codes(policy_raw.get("blocked_countries")),
        "blocked_context_keywords": normalize_keywords(policy_raw.get("blocked_context_keywords")),
    }
    return Preset(name=name, description=description, domains=domains, policy=policy)


def _presets_from_file(path: Path) -> dict[str, Preset]:
    data = _load_json(path)
    items = data.get("presets")
    if not isinstance(items, list):
        raise CLIError(f"Invalid presets format in {path}: 'presets' array required.")
    result: dict[str, Preset] = {}
    for item in items:
        if not isinstance(item, dict):
            raise CLIError(f"Invalid preset item in {path}: object required.")
        preset = _normalize_preset(item)
        result[preset.name] = preset
    return result


def load_presets() -> dict[str, Preset]:
    presets = _presets_from_file(DEFAULT_PRESETS_PATH)
    if USER_PRESETS_PATH.exists():
        # user presets override defaults by name
        presets.update(_presets_from_file(USER_PRESETS_PATH))
    return presets


def list_presets() -> list[Preset]:
    return [value for _, value in sorted(load_presets().items(), key=lambda x: x[0])]


def get_preset(name: str) -> Preset:
    target = normalize_resource_name(name)
    presets = load_presets()
    if target not in presets:
        raise CLIError(f"Preset '{target}' not found.")
    return presets[target]
