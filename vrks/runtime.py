from __future__ import annotations

import shutil
from pathlib import Path

from .constants import BIN_PATH, RUNTIME_ROOT, SERVICE_NAME, SERVICE_PATH, TIMER_NAME, TIMER_PATH
from .system import run


def install_runtime_tree(project_root: Path) -> Path:
    package_src = project_root / "vrks"
    package_dst = RUNTIME_ROOT / "vrks"

    if RUNTIME_ROOT.exists():
        shutil.rmtree(RUNTIME_ROOT)
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
    shutil.copytree(package_src, package_dst)

    launcher = f"""#!/usr/bin/env python3
import sys
sys.path.insert(0, {str(RUNTIME_ROOT)!r})
from vrks.cli import main
raise SystemExit(main())
"""
    BIN_PATH.parent.mkdir(parents=True, exist_ok=True)
    BIN_PATH.write_text(launcher, encoding="utf-8")
    BIN_PATH.chmod(0o755)
    return BIN_PATH


def write_systemd_units(exec_path: str) -> None:
    service = f"""[Unit]
Description=Refresh VPN Resource Kill-Switch nftables rules
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart={exec_path} apply
"""
    timer = f"""[Unit]
Description=Periodic refresh for VPN Resource Kill-Switch rules

[Timer]
OnBootSec=45s
OnUnitActiveSec=10m
RandomizedDelaySec=30s
Persistent=true
Unit={SERVICE_NAME}

[Install]
WantedBy=timers.target
"""
    SERVICE_PATH.write_text(service, encoding="utf-8")
    TIMER_PATH.write_text(timer, encoding="utf-8")


def enable_timer() -> None:
    run(["systemctl", "daemon-reload"], check=True)
    run(["systemctl", "enable", "--now", TIMER_NAME], check=True)


def disable_timer() -> None:
    run(["systemctl", "disable", "--now", TIMER_NAME], check=False)
    run(["systemctl", "daemon-reload"], check=False)
