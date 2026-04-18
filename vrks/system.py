from __future__ import annotations

import os
import subprocess

from .errors import CLIError


def run(
    cmd: list[str],
    *,
    check: bool = True,
    input_data: str | None = None,
) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(
        cmd,
        text=True,
        capture_output=True,
        input=input_data,
        check=False,
    )
    if check and proc.returncode != 0:
        raise CLIError(
            "Command failed: "
            + " ".join(cmd)
            + f"\nexit={proc.returncode}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        )
    return proc


def ensure_root() -> None:
    if os.geteuid() != 0:
        raise CLIError("This command must run as root (use sudo).")
