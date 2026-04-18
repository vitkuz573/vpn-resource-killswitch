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

## Architecture

- `vrks/cli.py`: CLI commands.
- `vrks/gui.py`: local web dashboard.
- `vrks/service.py`: orchestration layer (setup/apply/probe/resource management).
- `vrks/network.py`: interface detection, DNS resolve, egress country/server lookup, probe.
- `vrks/firewall.py`: nftables rule generation and apply.
- `vrks/storage.py`: config/state persistence.
- `vrks/runtime.py`: runtime install (`/usr/local/bin/vrks`) + systemd timer/watch/dispatcher integration.

## Quick start

```bash
cd /home/vitaly/projects/vpn-resource-killswitch
sudo python3 vrks.py bootstrap --preset antigravity --vpn-interface amn0
sudo python3 vrks.py access-check --resource antigravity
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

## Access Check

Simple yes/no access verdict for a resource:

```bash
sudo python3 vrks.py access-check --resource antigravity
```

Result is PASS only when effective mode behavior is correct:
- `vpn_only`: reachable via VPN and blocked outside VPN
- `hard_block`: blocked via VPN and outside VPN

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
- `GET /v1/resources`
- `POST /v1/resources`
- `DELETE /v1/resources/{name}`
- `POST /v1/access-check`
- `POST /v1/probe`
- `POST /v1/verify`
- `POST /v1/apply`

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
      "domains": ["mrdoob.com", "elgoog.im"],
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
  --domain elgoog.im \
  --domain mrdoob.com \
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
