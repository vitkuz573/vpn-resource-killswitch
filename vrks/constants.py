from __future__ import annotations

import re
from pathlib import Path


APP_NAME = "vpn-resource-killswitch"
CONFIG_VERSION = 3

CONFIG_DIR = Path("/etc/vpn-resource-killswitch")
CONFIG_PATH = CONFIG_DIR / "config.json"
CA_DIR = CONFIG_DIR / "ca"
CA_KEY_PATH = CA_DIR / "vrks-local-ca.key.pem"
CA_CERT_PATH = CA_DIR / "vrks-local-ca.crt"
CA_SERIAL_PATH = CA_DIR / "vrks-local-ca.srl"
STATE_DIR = Path("/var/lib/vpn-resource-killswitch")
STATE_PATH = STATE_DIR / "state.json"
TLS_CERT_CACHE_DIR = STATE_DIR / "tls-certs"
NM_DISPATCHER_PATH = Path("/etc/NetworkManager/dispatcher.d/90-vrks-refresh")

BIN_PATH = Path("/usr/local/bin/vrks")
RUNTIME_ROOT = Path("/usr/local/lib/vpn-resource-killswitch")

NFT_TABLE = "vpn_resource_killswitch"
NFT_NAT_TABLE = "vpn_resource_killswitch_nat"

SERVICE_NAME = "vpn-resource-killswitch-refresh.service"
TIMER_NAME = "vpn-resource-killswitch-refresh.timer"
SERVICE_PATH = Path("/etc/systemd/system") / SERVICE_NAME
TIMER_PATH = Path("/etc/systemd/system") / TIMER_NAME
WATCH_SERVICE_NAME = "vpn-resource-killswitch-watch.service"
WATCH_SERVICE_PATH = Path("/etc/systemd/system") / WATCH_SERVICE_NAME
BLOCKPAGE_SERVICE_NAME = "vpn-resource-killswitch-blockpage.service"
BLOCKPAGE_SERVICE_PATH = Path("/etc/systemd/system") / BLOCKPAGE_SERVICE_NAME
TLS_BLOCKPAGE_SERVICE_NAME = "vpn-resource-killswitch-blockpage-tls.service"
TLS_BLOCKPAGE_SERVICE_PATH = Path("/etc/systemd/system") / TLS_BLOCKPAGE_SERVICE_NAME

DEFAULT_PROFILE_NAME = "default"
BLOCK_PAGE_HOST = "127.0.0.1"
BLOCK_PAGE_PORT = 8765
TLS_BLOCK_PAGE_PORT = 8766

GEO_LOOKUP_URL = "https://ipwho.is/"

IFNAME_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,32}$")
RESOURCE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")
