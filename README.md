# VPN Resource Kill-Switch (`vrks`)

Generic VPN kill-switch for any web resource.
Core logic is generic; service-specific behavior comes from external presets.

## What it does

- Blocks configured resources on non-VPN interfaces.
- Supports per-resource policy:
  - `required_country`
  - `required_server` (substring match against VPN egress IP / org / ISP / domain)
  - `allowed_countries` (ISO code allow-list)
  - `blocked_countries` (ISO code deny-list)
  - `blocked_context_keywords` (substring deny-list over VPN context: country/region/city/org/isp/domain/ip)
- If policy mismatch happens, resource is hard-blocked on all interfaces.
- Works with any VPN provider because enforcement is interface-based (`tun`, `wg`, etc.).
- Includes both CLI and web GUI.
- Instant reaction path: realtime `watch` service + NetworkManager dispatcher + periodic timer.
- Transition notifications: desktop/syslog alerts when a resource enters `hard_block` or is restored.

## Architecture

- `vrks/cli.py`: CLI commands.
- `vrks/gui.py`: local web dashboard.
- `vrks/service.py`: orchestration layer (setup/apply/probe/resource management).
- `vrks/network.py`: interface detection, DNS resolve, egress country/server lookup, probe.
- `vrks/discovery.py`: domain crawler/extractor for automatic coverage expansion.
- `vrks/notifications.py`: cross-platform notification dispatch (`linux`/`macOS`/`windows` + logger fallback).
- `vrks/blockpage.py`: local HTTP block page server (`451`).
- `vrks/blockpage_tls.py`: local HTTPS block page server with SNI-based certificates.
- `vrks/mitm_ca.py`: local CA lifecycle and per-domain certificate issuance for HTTPS block page.
- `vrks/firewall.py`: nftables rule generation and apply.
- `vrks/storage.py`: config/state persistence.
- `vrks/runtime.py`: runtime install (`/usr/local/bin/vrks`) + systemd timer/watch/dispatcher/blockpage services.

## Quick start

```bash
cd /home/vitaly/projects/vpn-resource-killswitch
sudo python3 vrks.py bootstrap --preset antigravity --vpn-interface amn0
sudo python3 vrks.py sync --resource antigravity --access-all-domains
sudo python3 vrks.py access-check --resource antigravity --all-domains
sudo python3 vrks.py verify
```

## Generic setup (without presets)

`setup` is fully generic and requires explicit domains:

```bash
sudo python3 vrks.py setup \
  --vpn-interface amn0 \
  --name myservice \
  --domain myservice.com \
  --domain api.myservice.com
```

## Add custom resource

```bash
sudo python3 vrks.py resource-add \
  --name youtube \
  --domain youtube.com \
  --domain ytimg.com \
  --allow-country US \
  --allow-country DE \
  --block-country RU \
  --block-context crimea \
  --block-context donetsk \
  --server m247

sudo python3 vrks.py apply
```

## GUI

```bash
sudo python3 vrks.py gui --host 127.0.0.1 --port 8877
```

Then open `http://127.0.0.1:8877`.

## Verify / Watch

```bash
sudo python3 vrks.py verify
sudo python3 vrks.py watch
```

`watch` usually runs as systemd service and reapplies rules instantly on route/link/address changes.

## Notifications

When kill-switch state changes, VRKS emits events:
- Resource moved to `hard_block` (critical)
- Resource restored to `vpn_only`
- VPN interface down/up transitions

Delivery:
- Desktop notification backends:
  - Linux: `notify-send` via desktop DBus session
  - macOS: `osascript` notification
  - Windows: PowerShell balloon notification
- Syslog/journal fallback (`logger -t vrks`)

Events are also stored in state (`/var/lib/vpn-resource-killswitch/state.json`, key: `events`).

## Browser Block Page (HTTP + HTTPS)

VRKS runs two local block-page services and redirects blocked traffic to them:

- HTTP service: `vpn-resource-killswitch-blockpage.service` (`http://127.0.0.1:8765`)
- HTTPS service: `vpn-resource-killswitch-blockpage-tls.service` (`https://127.0.0.1:8766`)
- Block response code: `451`

For full HTTPS block page (without browser certificate warnings), initialize and trust local CA:

```bash
sudo python3 vrks.py mitm-ca-init
sudo python3 vrks.py mitm-ca-trust
sudo python3 vrks.py mitm-ca-status
```

Notes:
- Blocked HTTP traffic always renders VRKS block page.
- Blocked HTTPS traffic renders VRKS block page via local MITM TLS endpoint.
- If local CA is not trusted yet, browsers will show TLS warning for blocked HTTPS pages.

## Presets

`antigravity` ships as built-in preset (data file, not hardcoded logic).

```bash
sudo python3 vrks.py preset-list
sudo python3 vrks.py preset-apply --name antigravity --replace
```

Default preset catalog:
- `vrks/presets.default.json`

Optional override catalog:
- `/etc/vpn-resource-killswitch/presets.json`

User presets override built-ins by preset name.

## Autodiscovery / Self-Heal

Find hidden/secondary domains by crawling resource pages:

```bash
sudo python3 vrks.py discover --resource antigravity --depth 2 --json
```

Auto-merge missing domains for one resource:

```bash
sudo python3 vrks.py resource-autofill --resource antigravity --depth 2
```

Full self-heal cycle for one/all resources:

```bash
# all enabled resources
sudo python3 vrks.py sync

# one resource + strict access probe across all its domains
sudo python3 vrks.py sync --resource antigravity --access-all-domains
```

## Runtime Discovery (IDE/App Traffic)

Capture real network hosts (DNS + TLS SNI + HTTP Host) while any app runs:

```bash
sudo python3 vrks.py runtime-discover \
  --cmd "/opt/myapp/bin/myapp --profile test" \
  --run-as-user "$SUDO_USER" \
  --duration 60 \
  --include "service|api|cdn|googleapis|cloudfront" \
  --exclude "microsoft\\.com|cloudapp\\.azure\\.com|localhost|127\\.0\\.0\\.1"
```

Auto-merge runtime-discovered domains into resource profile:

```bash
sudo python3 vrks.py resource-runtime-autofill \
  --resource antigravity \
  --cmd "/opt/myapp/bin/myapp --profile test" \
  --run-as-user "$SUDO_USER" \
  --duration 60 \
  --include "service|api|cdn|googleapis|cloudfront" \
  --exclude "microsoft\\.com|cloudapp\\.azure\\.com|localhost|127\\.0\\.0\\.1"
```

## Access Check

Simple yes/no access verdict for a resource:

```bash
sudo python3 vrks.py access-check --resource antigravity
sudo python3 vrks.py access-check --resource antigravity --all-domains
```

Result is PASS only when effective mode behavior is correct:
- `vpn_only`: reachable via VPN and blocked outside VPN
- `hard_block`: blocked via VPN and outside VPN

Blocked probe result includes firewall-reject, TLS failure, or HTTP `451` block page response.

## REST API + OpenAPI

Run REST API server:

```bash
sudo python3 vrks.py api --host 127.0.0.1 --port 8787
```

Generated OpenAPI:
- `http://127.0.0.1:8787/openapi.json`
- `http://127.0.0.1:8787/docs`

Main endpoints:
- `GET /v1/status`
- `POST /v1/bootstrap`
- `GET /v1/presets`
- `POST /v1/presets/{name}/apply`
- `POST /v1/discover`
- `POST /v1/resources/{name}/autofill`
- `POST /v1/runtime/discover`
- `POST /v1/resources/{name}/runtime-autofill`
- `POST /v1/sync`
- `GET /v1/resources`
- `POST /v1/resources`
- `DELETE /v1/resources/{name}`
- `POST /v1/access-check`
- `POST /v1/probe`
- `POST /v1/verify`
- `POST /v1/apply`
- `GET /v1/mitm/ca-status`
- `POST /v1/mitm/ca-init`
- `POST /v1/mitm/ca-trust`

Arch dependencies:

```bash
sudo pacman -S python-fastapi uvicorn python-pydantic
```

## Config format

Stored at `/etc/vpn-resource-killswitch/config.json`:

```json
{
  "version": 3,
  "vpn_interface": "amn0",
  "resources": [
    {
      "name": "antigravity",
      "domains": [
        "antigravity.google",
        "antigravity-unleash.goog",
        "cloudcode-pa.googleapis.com",
        "edgedl.me.gvt1.com",
        "play.googleapis.com"
      ],
      "policy": {
        "required_country": null,
        "required_server": null,
        "allowed_countries": [],
        "blocked_countries": [],
        "blocked_context_keywords": []
      },
      "enabled": true
    }
  ]
}
```

## Google Restrictions Baseline

For country-level Google embargo logic, use:

- `CU` (Cuba)
- `IR` (Iran)
- `KP` (North Korea)

Region-level Google restrictions (Crimea, DNR, LNR) are not representable via plain country code and need region-aware geodata.

Example strict antigravity policy without hardcoded defaults:

```bash
sudo python3 vrks.py resource-add \
  --name antigravity \
  --domain antigravity.google \
  --domain antigravity-unleash.goog \
  --domain antigravity-auto-updater-974169037036.us-central1.run.app \
  --domain cloudcode-pa.googleapis.com \
  --domain edgedl.me.gvt1.com \
  --domain play.googleapis.com \
  --domain accounts.google.com \
  --domain oauth2.googleapis.com \
  --block-country RU \
  --block-country CU \
  --block-country IR \
  --block-country KP \
  --block-context crimea \
  --block-context donetsk \
  --block-context luhansk \
  --replace
sudo python3 vrks.py apply
```

## Tests

```bash
python3 -m unittest discover -s tests -v
```
