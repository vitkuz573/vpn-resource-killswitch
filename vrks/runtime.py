from __future__ import annotations

import shutil
from pathlib import Path

from .constants import (
    BLOCK_PAGE_HOST,
    BLOCK_PAGE_PORT,
    BLOCKPAGE_SERVICE_NAME,
    BLOCKPAGE_SERVICE_PATH,
    BIN_PATH,
    NM_DISPATCHER_PATH,
    RUNTIME_ROOT,
    SERVICE_NAME,
    SERVICE_PATH,
    TIMER_NAME,
    TIMER_PATH,
    TLS_BLOCK_PAGE_PORT,
    TLS_BLOCKPAGE_SERVICE_NAME,
    TLS_BLOCKPAGE_SERVICE_PATH,
    WATCH_SERVICE_NAME,
    WATCH_SERVICE_PATH,
)
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
OnUnitActiveSec=30s
RandomizedDelaySec=30s
Persistent=true
Unit={SERVICE_NAME}

[Install]
WantedBy=timers.target
"""
    watch_service = f"""[Unit]
Description=Realtime VPN Resource Kill-Switch watcher
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={exec_path} watch --debounce 0.2
Restart=always
RestartSec=0.5

[Install]
WantedBy=multi-user.target
"""
    blockpage_service = f"""[Unit]
Description=VRKS block page server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={exec_path} blockpage --host {BLOCK_PAGE_HOST} --port {BLOCK_PAGE_PORT}
Restart=always
RestartSec=0.5

[Install]
WantedBy=multi-user.target
"""
    tls_blockpage_service = f"""[Unit]
Description=VRKS TLS block page server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={exec_path} blockpage-tls --host {BLOCK_PAGE_HOST} --port {TLS_BLOCK_PAGE_PORT}
Restart=always
RestartSec=0.5

[Install]
WantedBy=multi-user.target
"""
    SERVICE_PATH.write_text(service, encoding="utf-8")
    TIMER_PATH.write_text(timer, encoding="utf-8")
    WATCH_SERVICE_PATH.write_text(watch_service, encoding="utf-8")
    BLOCKPAGE_SERVICE_PATH.write_text(blockpage_service, encoding="utf-8")
    TLS_BLOCKPAGE_SERVICE_PATH.write_text(tls_blockpage_service, encoding="utf-8")


def install_nm_dispatcher_hook() -> None:
    NM_DISPATCHER_PATH.parent.mkdir(parents=True, exist_ok=True)
    script = f"""#!/bin/sh
# Auto-refresh VRKS rules on network transitions.
IFACE="$1"
STATE="$2"
case "$STATE" in
  up|down|vpn-up|vpn-down|dhcp4-change|dhcp6-change|connectivity-change|hostname)
    /usr/bin/systemctl start {SERVICE_NAME} >/dev/null 2>&1 || true
    ;;
  *)
    ;;
esac
exit 0
"""
    NM_DISPATCHER_PATH.write_text(script, encoding="utf-8")
    NM_DISPATCHER_PATH.chmod(0o755)


def remove_nm_dispatcher_hook() -> None:
    if NM_DISPATCHER_PATH.exists():
        NM_DISPATCHER_PATH.unlink()


def enable_timer() -> None:
    run(["systemctl", "daemon-reload"], check=True)
    run(["systemctl", "enable", "--now", TIMER_NAME], check=True)
    run(["systemctl", "enable", "--now", WATCH_SERVICE_NAME], check=True)
    run(["systemctl", "enable", "--now", BLOCKPAGE_SERVICE_NAME], check=True)
    run(["systemctl", "enable", "--now", TLS_BLOCKPAGE_SERVICE_NAME], check=True)


def disable_timer() -> None:
    run(["systemctl", "disable", "--now", TIMER_NAME], check=False)
    run(["systemctl", "disable", "--now", WATCH_SERVICE_NAME], check=False)
    run(["systemctl", "disable", "--now", BLOCKPAGE_SERVICE_NAME], check=False)
    run(["systemctl", "disable", "--now", TLS_BLOCKPAGE_SERVICE_NAME], check=False)
    run(["systemctl", "daemon-reload"], check=False)
