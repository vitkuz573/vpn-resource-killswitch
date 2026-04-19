from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path
from typing import Any

try:
    import pwd
except ImportError:  # pragma: no cover - non-POSIX platforms
    pwd = None  # type: ignore[assignment]

from .constants import (
    CA_CERT_PATH,
    CA_DIR,
    CA_KEY_PATH,
    CA_SERIAL_PATH,
    TLS_CERT_CACHE_DIR,
)
from .errors import CLIError
from .network import normalize_domain
from .system import ensure_root, run


def _require_openssl() -> None:
    if shutil.which("openssl") is None:
        raise CLIError("openssl is required for MITM CA/certificate generation.")


def _linux_user_home(username: str) -> Path | None:
    if not username:
        return None
    if pwd is None:
        return None
    try:
        return Path(pwd.getpwnam(username).pw_dir)
    except KeyError:
        return None


def _trust_linux_nss_db(cert_path: str) -> list[str]:
    certutil = shutil.which("certutil")
    if certutil is None:
        return []

    users: list[str] = []
    current_user = (os.environ.get("USER") or "").strip()
    if current_user:
        users.append(current_user)
    sudo_user = (os.environ.get("SUDO_USER") or "").strip()
    if sudo_user and sudo_user not in users:
        users.append(sudo_user)
    if not users:
        return []

    import_cert_path = cert_path
    temp_cert_path: Path | None = None
    if os.geteuid() == 0:
        temp_cert_path = Path("/tmp/vrks-local-ca-for-nss.crt")
        temp_cert_path.write_bytes(Path(cert_path).read_bytes())
        temp_cert_path.chmod(0o644)
        import_cert_path = str(temp_cert_path)

    trusted_targets: list[str] = []
    try:
        for user in users:
            home = _linux_user_home(user)
            if home is None:
                continue
            db_dir = home / ".pki" / "nssdb"
            db_spec = f"sql:{db_dir}"

            if os.geteuid() == 0:
                run(["sudo", "-u", user, "--", "mkdir", "-p", str(db_dir)], check=False)
                run(
                    ["sudo", "-u", user, "--", certutil, "-d", db_spec, "-D", "-n", "VRKS Local MITM CA"],
                    check=False,
                )
                add_proc = run(
                    [
                        "sudo",
                        "-u",
                        user,
                        "--",
                        certutil,
                        "-d",
                        db_spec,
                        "-A",
                        "-t",
                        "C,,",
                        "-n",
                        "VRKS Local MITM CA",
                        "-i",
                        import_cert_path,
                    ],
                    check=False,
                )
            else:
                db_dir.mkdir(parents=True, exist_ok=True)
                run([certutil, "-d", db_spec, "-D", "-n", "VRKS Local MITM CA"], check=False)
                add_proc = run(
                    [
                        certutil,
                        "-d",
                        db_spec,
                        "-A",
                        "-t",
                        "C,,",
                        "-n",
                        "VRKS Local MITM CA",
                        "-i",
                        import_cert_path,
                    ],
                    check=False,
                )
            if add_proc.returncode == 0:
                trusted_targets.append(str(db_dir))
    finally:
        if temp_cert_path is not None and temp_cert_path.exists():
            temp_cert_path.unlink()
    return trusted_targets


def local_ca_exists() -> bool:
    return CA_KEY_PATH.exists() and CA_CERT_PATH.exists()


def local_ca_status() -> dict[str, Any]:
    return {
        "exists": local_ca_exists(),
        "ca_dir": str(CA_DIR),
        "ca_key_path": str(CA_KEY_PATH),
        "ca_cert_path": str(CA_CERT_PATH),
        "ca_serial_path": str(CA_SERIAL_PATH),
        "tls_cert_cache_dir": str(TLS_CERT_CACHE_DIR),
    }


def ensure_local_ca(*, common_name: str = "VRKS Local MITM CA") -> dict[str, Any]:
    ensure_root()
    _require_openssl()

    CA_DIR.mkdir(parents=True, exist_ok=True)
    CA_DIR.chmod(0o700)
    TLS_CERT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    TLS_CERT_CACHE_DIR.chmod(0o700)

    if local_ca_exists():
        return {"created": False, **local_ca_status()}

    # Reset partial state if only one file exists.
    if CA_KEY_PATH.exists():
        CA_KEY_PATH.unlink()
    if CA_CERT_PATH.exists():
        CA_CERT_PATH.unlink()
    if CA_SERIAL_PATH.exists():
        CA_SERIAL_PATH.unlink()

    run(
        [
            "openssl",
            "genrsa",
            "-out",
            str(CA_KEY_PATH),
            "4096",
        ]
    )
    run(
        [
            "openssl",
            "req",
            "-x509",
            "-new",
            "-key",
            str(CA_KEY_PATH),
            "-sha256",
            "-days",
            "3650",
            "-subj",
            f"/CN={common_name}",
            "-out",
            str(CA_CERT_PATH),
        ]
    )
    CA_KEY_PATH.chmod(0o600)
    CA_CERT_PATH.chmod(0o644)
    return {"created": True, **local_ca_status()}


def issue_server_cert(domain: str) -> tuple[Path, Path]:
    ensure_root()
    _require_openssl()
    if not local_ca_exists():
        ensure_local_ca()

    host = normalize_domain(domain)
    leaf_dir = TLS_CERT_CACHE_DIR / host
    leaf_dir.mkdir(parents=True, exist_ok=True)
    leaf_dir.chmod(0o700)

    cert_path = leaf_dir / "cert.pem"
    key_path = leaf_dir / "key.pem"
    csr_path = leaf_dir / "req.csr"
    ext_path = leaf_dir / "v3.ext"

    if cert_path.exists() and key_path.exists():
        return cert_path, key_path

    ext_path.write_text(
        "\n".join(
            [
                "basicConstraints=CA:FALSE",
                "keyUsage=digitalSignature,keyEncipherment",
                "extendedKeyUsage=serverAuth",
                f"subjectAltName=DNS:{host}",
                "",
            ]
        ),
        encoding="utf-8",
    )

    run(
        [
            "openssl",
            "req",
            "-new",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            str(key_path),
            "-out",
            str(csr_path),
            "-subj",
            f"/CN={host}",
        ]
    )
    run(
        [
            "openssl",
            "x509",
            "-req",
            "-in",
            str(csr_path),
            "-CA",
            str(CA_CERT_PATH),
            "-CAkey",
            str(CA_KEY_PATH),
            "-CAcreateserial",
            "-CAserial",
            str(CA_SERIAL_PATH),
            "-out",
            str(cert_path),
            "-days",
            "825",
            "-sha256",
            "-extfile",
            str(ext_path),
        ]
    )
    if csr_path.exists():
        csr_path.unlink()
    if ext_path.exists():
        ext_path.unlink()
    key_path.chmod(0o600)
    cert_path.chmod(0o644)
    return cert_path, key_path


def trust_local_ca() -> dict[str, Any]:
    ensure_root()
    if not local_ca_exists():
        raise CLIError("Local CA does not exist. Run CA init first.")

    platform_name = sys.platform.lower()
    cert_path = str(CA_CERT_PATH)

    if platform_name.startswith("linux"):
        if shutil.which("update-ca-certificates"):
            target_dir = Path("/usr/local/share/ca-certificates")
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / "vrks-local-ca.crt"
            target.write_bytes(CA_CERT_PATH.read_bytes())
            run(["update-ca-certificates"])
            nss_targets = _trust_linux_nss_db(cert_path)
            return {
                "trusted": True,
                "method": "update-ca-certificates",
                "target": str(target),
                "nss_targets": nss_targets,
            }

        if shutil.which("trust"):
            run(["trust", "anchor", "--store", cert_path])
            if shutil.which("update-ca-trust"):
                run(["update-ca-trust"])
            nss_targets = _trust_linux_nss_db(cert_path)
            return {
                "trusted": True,
                "method": "trust-anchor",
                "target": cert_path,
                "nss_targets": nss_targets,
            }

        if shutil.which("update-ca-trust"):
            anchor_dir = Path("/etc/pki/ca-trust/source/anchors")
            anchor_dir.mkdir(parents=True, exist_ok=True)
            target = anchor_dir / "vrks-local-ca.crt"
            target.write_bytes(CA_CERT_PATH.read_bytes())
            run(["update-ca-trust"])
            nss_targets = _trust_linux_nss_db(cert_path)
            return {
                "trusted": True,
                "method": "update-ca-trust",
                "target": str(target),
                "nss_targets": nss_targets,
            }

        raise CLIError("Cannot trust CA on Linux: no update-ca-certificates/trust/update-ca-trust found.")

    if platform_name == "darwin":
        run(
            [
                "security",
                "add-trusted-cert",
                "-d",
                "-r",
                "trustRoot",
                "-k",
                "/Library/Keychains/System.keychain",
                cert_path,
            ]
        )
        return {"trusted": True, "method": "security-add-trusted-cert", "target": cert_path}

    if platform_name.startswith("win"):
        if shutil.which("certutil") is None:
            raise CLIError("certutil not found on Windows.")
        run(["certutil", "-addstore", "-f", "Root", cert_path])
        return {"trusted": True, "method": "certutil-root-store", "target": cert_path}

    raise CLIError(f"Unsupported platform for automatic CA trust: {sys.platform}")
