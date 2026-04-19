from __future__ import annotations

import ipaddress
import re
import shlex
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from .errors import CLIError
from .network import normalize_domain


TSHARK_FILTER = "dns.qry.name || tls.handshake.extensions_server_name || http.host"


@dataclass
class RuntimeDiscoveryResult:
    command: list[str]
    capture_interface: str
    duration: int
    startup_delay: float
    capture_lines: int
    domains: list[str]
    excluded_domains: list[str]
    invalid_values: list[str]
    command_returncode: int | None
    command_timed_out: bool
    tshark_stderr_tail: str


def parse_command(command: str) -> list[str]:
    parts = shlex.split(command)
    if not parts:
        raise CLIError("Command cannot be empty.")
    return parts


def _strip_host(raw: str) -> str | None:
    value = raw.strip().strip("\"' ")
    if not value:
        return None

    if "://" in value:
        value = value.split("://", 1)[1]

    value = value.split("/", 1)[0]
    value = value.split("?", 1)[0]
    value = value.split("#", 1)[0]
    value = value.strip().lower().rstrip(".")
    if not value:
        return None

    # Drop IPv6-like values quickly.
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    if value.count(":") > 1 and "." not in value:
        return None

    # Drop optional :port for host:port values.
    if ":" in value:
        host_part, _, port_part = value.rpartition(":")
        if host_part and port_part.isdigit():
            value = host_part

    value = value.strip().lower().rstrip(".")
    if not value:
        return None
    return value


def _valid_domain(raw: str) -> str | None:
    host = _strip_host(raw)
    if not host:
        return None
    if host == "localhost":
        return None
    try:
        ipaddress.ip_address(host)
        return None
    except ValueError:
        pass

    try:
        return normalize_domain(host)
    except CLIError:
        return None


def extract_domains_from_capture(capture_text: str) -> tuple[list[str], list[str], int]:
    domains: set[str] = set()
    invalid_values: set[str] = set()
    capture_lines = 0

    for line in capture_text.splitlines():
        if not line.strip():
            continue
        capture_lines += 1
        fields = line.split("\t")
        for item in fields:
            value = item.strip()
            if not value:
                continue
            domain = _valid_domain(value)
            if domain is None:
                invalid_values.add(value)
                continue
            domains.add(domain)

    return sorted(domains), sorted(invalid_values), capture_lines


def _compile_patterns(patterns: list[str] | None) -> list[re.Pattern[str]]:
    compiled: list[re.Pattern[str]] = []
    for pattern in (patterns or []):
        text = pattern.strip()
        if not text:
            continue
        try:
            compiled.append(re.compile(text, re.IGNORECASE))
        except re.error as exc:
            raise CLIError(f"Invalid regex pattern '{pattern}': {exc}") from exc
    return compiled


def filter_domains(
    domains: list[str], *, include_patterns: list[str] | None, exclude_patterns: list[str] | None
) -> tuple[list[str], list[str]]:
    if not domains:
        return [], []
    include = _compile_patterns(include_patterns)
    exclude = _compile_patterns(exclude_patterns)

    kept: list[str] = []
    excluded: list[str] = []
    for domain in sorted(set(domains)):
        if include and not any(pattern.search(domain) for pattern in include):
            excluded.append(domain)
            continue
        if exclude and any(pattern.search(domain) for pattern in exclude):
            excluded.append(domain)
            continue
        kept.append(domain)
    return kept, sorted(set(excluded))


def discover_runtime_domains(
    *,
    command: list[str],
    duration: int,
    startup_delay: float,
    capture_interface: str,
    include_patterns: list[str] | None,
    exclude_patterns: list[str] | None,
) -> RuntimeDiscoveryResult:
    if not command:
        raise CLIError("Command cannot be empty.")
    if duration < 5 or duration > 1800:
        raise CLIError("Duration must be between 5 and 1800 seconds.")
    if startup_delay < 0 or startup_delay >= duration:
        raise CLIError("startup_delay must be >= 0 and less than duration.")
    if not shutil.which("tshark"):
        raise CLIError("tshark not found. Install wireshark-cli/tshark first.")

    with tempfile.TemporaryDirectory(prefix="vrks-capture-") as tmpdir:
        capture_path = Path(tmpdir) / "capture.tsv"
        stderr_path = Path(tmpdir) / "tshark.stderr"
        capture_path.write_text("", encoding="utf-8")
        stderr_path.write_text("", encoding="utf-8")

        tshark_cmd = [
            "tshark",
            "-i",
            capture_interface,
            "-a",
            f"duration:{duration}",
            "-Y",
            TSHARK_FILTER,
            "-T",
            "fields",
            "-e",
            "dns.qry.name",
            "-e",
            "tls.handshake.extensions_server_name",
            "-e",
            "http.host",
        ]

        with capture_path.open("w", encoding="utf-8") as capture_file, stderr_path.open(
            "w", encoding="utf-8"
        ) as stderr_file:
            tshark_proc = subprocess.Popen(
                tshark_cmd,
                stdout=capture_file,
                stderr=stderr_file,
                text=True,
            )

            command_proc: subprocess.Popen[str] | None = None
            command_returncode: int | None = None
            command_timed_out = False

            try:
                time.sleep(startup_delay)
                command_proc = subprocess.Popen(
                    command,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    text=True,
                )
                command_budget = max(1.0, duration - startup_delay - 1.0)
                try:
                    command_returncode = command_proc.wait(timeout=command_budget)
                except subprocess.TimeoutExpired:
                    command_timed_out = True
                    command_proc.terminate()
                    try:
                        command_proc.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        command_proc.kill()
                        command_proc.wait(timeout=2)

                try:
                    tshark_proc.wait(timeout=duration + 15)
                except subprocess.TimeoutExpired:
                    tshark_proc.terminate()
                    try:
                        tshark_proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        tshark_proc.kill()
                        tshark_proc.wait(timeout=3)
            finally:
                if command_proc is not None and command_proc.poll() is None:
                    command_proc.terminate()
                    try:
                        command_proc.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        command_proc.kill()
                        command_proc.wait(timeout=2)
                if tshark_proc.poll() is None:
                    tshark_proc.terminate()
                    try:
                        tshark_proc.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        tshark_proc.kill()
                        tshark_proc.wait(timeout=2)

        if tshark_proc.returncode not in {0, None}:
            stderr_text = stderr_path.read_text(encoding="utf-8", errors="ignore").strip()
            raise CLIError(f"tshark failed with exit={tshark_proc.returncode}: {stderr_text}")

        capture_text = capture_path.read_text(encoding="utf-8", errors="ignore")
        raw_domains, invalid_values, capture_lines = extract_domains_from_capture(capture_text)
        filtered_domains, excluded = filter_domains(
            raw_domains,
            include_patterns=include_patterns,
            exclude_patterns=exclude_patterns,
        )

        stderr_tail = stderr_path.read_text(encoding="utf-8", errors="ignore").strip()
        if len(stderr_tail) > 2000:
            stderr_tail = stderr_tail[-2000:]

        return RuntimeDiscoveryResult(
            command=command,
            capture_interface=capture_interface,
            duration=duration,
            startup_delay=startup_delay,
            capture_lines=capture_lines,
            domains=filtered_domains,
            excluded_domains=excluded,
            invalid_values=invalid_values,
            command_returncode=command_returncode,
            command_timed_out=command_timed_out,
            tshark_stderr_tail=stderr_tail,
        )
