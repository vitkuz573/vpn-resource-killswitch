from __future__ import annotations

import re
from pathlib import Path


APP_NAME = "vpn-resource-killswitch"
CONFIG_VERSION = 2

CONFIG_DIR = Path("/etc/vpn-resource-killswitch")
CONFIG_PATH = CONFIG_DIR / "config.json"
STATE_DIR = Path("/var/lib/vpn-resource-killswitch")
STATE_PATH = STATE_DIR / "state.json"
NM_DISPATCHER_PATH = Path("/etc/NetworkManager/dispatcher.d/90-vrks-refresh")

BIN_PATH = Path("/usr/local/bin/vrks")
RUNTIME_ROOT = Path("/usr/local/lib/vpn-resource-killswitch")

NFT_TABLE = "vpn_resource_killswitch"

SERVICE_NAME = "vpn-resource-killswitch-refresh.service"
TIMER_NAME = "vpn-resource-killswitch-refresh.timer"
SERVICE_PATH = Path("/etc/systemd/system") / SERVICE_NAME
TIMER_PATH = Path("/etc/systemd/system") / TIMER_NAME
WATCH_SERVICE_NAME = "vpn-resource-killswitch-watch.service"
WATCH_SERVICE_PATH = Path("/etc/systemd/system") / WATCH_SERVICE_NAME

DEFAULT_PROFILE_NAME = "antigravity"
DEFAULT_PROFILE_DOMAINS = ("mrdoob.com", "elgoog.im")
# Country-level Google embargo baseline from Google Ads help center (2026-04):
# Cuba, Iran, North Korea. Region-only restrictions (Crimea, DNR, LNR) are handled by region,
# and cannot be reliably detected from country_code-only geolocation APIs.
GOOGLE_OFAC_COUNTRY_CODES = ("CU", "IR", "KP")

GEO_LOOKUP_URL = "https://ipwho.is/"

IFNAME_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,32}$")
RESOURCE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")
