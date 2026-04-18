# VPN Resource Kill-Switch (`vrks`)

Generic VPN kill-switch for any web resource.
Default out-of-box profile is `antigravity`, but you can add any resource set.

## What it does

- Blocks configured resources on non-VPN interfaces.
- Supports per-resource policy:
  - `required_country`
  - `required_server` (substring match against VPN egress IP / org / ISP / domain)
- If policy mismatch happens, resource is hard-blocked on all interfaces.
- Works with any VPN provider because enforcement is interface-based (`tun`, `wg`, etc.).
- Includes both CLI and web GUI.

## Architecture

- `vrks/cli.py`: CLI commands.
- `vrks/gui.py`: local web dashboard.
- `vrks/service.py`: orchestration layer (setup/apply/probe/resource management).
- `vrks/network.py`: interface detection, DNS resolve, egress country/server lookup, probe.
- `vrks/firewall.py`: nftables rule generation and apply.
- `vrks/storage.py`: config/state persistence.
- `vrks/runtime.py`: runtime install (`/usr/local/bin/vrks`) + systemd timer.

## Quick start

```bash
cd /home/vitaly/projects/vpn-resource-killswitch
sudo python3 vrks.py setup --vpn-interface amn0
sudo python3 vrks.py status
```

## Add custom resource

```bash
sudo python3 vrks.py resource-add \
  --name youtube \
  --domain youtube.com \
  --domain ytimg.com \
  --country US \
  --server m247

sudo python3 vrks.py apply
```

## GUI

```bash
sudo python3 vrks.py gui --host 127.0.0.1 --port 8877
```

Then open `http://127.0.0.1:8877`.

## Config format

Stored at `/etc/vpn-resource-killswitch/config.json`:

```json
{
  "version": 2,
  "vpn_interface": "amn0",
  "resources": [
    {
      "name": "antigravity",
      "domains": ["mrdoob.com", "elgoog.im"],
      "policy": {
        "required_country": null,
        "required_server": null
      },
      "enabled": true
    }
  ]
}
```

## Tests

```bash
python3 -m unittest discover -s tests -v
```
