from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

try:
    import pwd
except ImportError:  # pragma: no cover - non-POSIX platforms
    pwd = None  # type: ignore[assignment]


def _run_quiet(cmd: list[str], env: dict[str, str] | None = None) -> int:
    proc = subprocess.run(
        cmd,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
        env=env,
    )
    return proc.returncode


def _user_from_uid(uid: int) -> str | None:
    if pwd is None:
        return None
    try:
        return pwd.getpwuid(uid).pw_name
    except KeyError:
        return None


def _candidate_users() -> list[tuple[str, int]]:
    candidates: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()

    def _add(user: str | None, uid: int | None) -> None:
        if not user or uid is None or uid <= 0:
            return
        key = (user, uid)
        if key in seen:
            return
        seen.add(key)
        candidates.append(key)

    current_uid = os.geteuid()
    current_user = _user_from_uid(current_uid)
    if current_uid > 0 and current_user:
        _add(current_user, current_uid)

    sudo_user = (os.environ.get("SUDO_USER") or "").strip()
    if sudo_user and pwd is not None:
        try:
            sudo_uid = pwd.getpwnam(sudo_user).pw_uid
        except Exception:
            sudo_uid = None
        _add(sudo_user, sudo_uid)

    run_user_root = Path("/run/user")
    if run_user_root.exists():
        for bus in sorted(run_user_root.glob("*/bus")):
            try:
                uid = int(bus.parent.name)
            except ValueError:
                continue
            user = _user_from_uid(uid)
            _add(user, uid)

    return candidates


def _notify_linux(*, title: str, message: str, severity: str) -> bool:
    if shutil.which("notify-send") is None:
        return False

    urgency = "critical" if severity == "critical" else "normal"
    sent = False

    for user, uid in _candidate_users():
        bus_path = Path(f"/run/user/{uid}/bus")
        if not bus_path.exists():
            continue
        env = os.environ.copy()
        env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={bus_path}"
        env["XDG_RUNTIME_DIR"] = f"/run/user/{uid}"

        cmd = ["notify-send", "-u", urgency, title, message]
        if os.geteuid() == 0:
            cmd = ["sudo", "-u", user, "--"] + cmd

        if _run_quiet(cmd, env=env) == 0:
            sent = True

    return sent


def _notify_macos(*, title: str, message: str) -> bool:
    if shutil.which("osascript") is None:
        return False

    escaped_title = title.replace("\\", "\\\\").replace('"', '\\"')
    escaped_message = message.replace("\\", "\\\\").replace('"', '\\"')
    script = f'display notification "{escaped_message}" with title "{escaped_title}"'
    return _run_quiet(["osascript", "-e", script]) == 0


def _notify_windows(*, title: str, message: str) -> bool:
    powershell = shutil.which("powershell") or shutil.which("pwsh")
    if not powershell:
        return False

    safe_title = title.replace("'", "''")
    safe_message = message.replace("'", "''")
    script = (
        "$ErrorActionPreference='SilentlyContinue';"
        "Add-Type -AssemblyName System.Windows.Forms | Out-Null;"
        "Add-Type -AssemblyName System.Drawing | Out-Null;"
        "$n = New-Object System.Windows.Forms.NotifyIcon;"
        "$n.Icon = [System.Drawing.SystemIcons]::Information;"
        f"$n.BalloonTipTitle = '{safe_title}';"
        f"$n.BalloonTipText = '{safe_message}';"
        "$n.Visible = $true;"
        "$n.ShowBalloonTip(5000);"
        "Start-Sleep -Milliseconds 5500;"
        "$n.Dispose();"
    )
    return _run_quiet([powershell, "-NoProfile", "-Command", script]) == 0


def send_notification(*, title: str, message: str, severity: str) -> bool:
    """
    Best-effort desktop notification with OS-specific backends.
    """
    platform_name = sys.platform.lower()
    if platform_name.startswith("linux"):
        return _notify_linux(title=title, message=message, severity=severity)
    if platform_name == "darwin":
        return _notify_macos(title=title, message=message)
    if platform_name.startswith("win"):
        return _notify_windows(title=title, message=message)
    return False


def publish_event(event: dict[str, Any]) -> None:
    title = str(event.get("title") or "VRKS event")
    message = str(event.get("message") or "")
    severity = str(event.get("severity") or "normal")

    # Journal/syslog fallback for headless systems.
    logger_message = f"[{severity}] {title}: {message}"
    if shutil.which("logger") is not None:
        _run_quiet(["logger", "-t", "vrks", logger_message])

    # Desktop notification when possible.
    send_notification(title=title, message=message, severity=severity)
