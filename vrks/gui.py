from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from .errors import CLIError
from .models import AppConfig
from .service import KillSwitchService


PAGE_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VPN Resource Kill-Switch</title>
  <style>
    :root {
      --bg: #f6f2ea;
      --card: #fffaf1;
      --ink: #1b2026;
      --accent: #0f7c90;
      --warn: #b25f32;
      --ok: #287748;
      --muted: #6e7378;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 16px/1.4 "IBM Plex Sans", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at 10% 10%, #ffe9c8 0, transparent 38%),
        radial-gradient(circle at 90% 20%, #d9f4f0 0, transparent 35%),
        var(--bg);
      min-height: 100vh;
      padding: 24px;
    }
    .grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    }
    .card {
      background: var(--card);
      border: 1px solid #eadfcf;
      border-radius: 16px;
      padding: 18px;
      box-shadow: 0 12px 30px rgba(43,53,64,0.06);
    }
    h1 { margin: 0 0 10px; font-size: 30px; letter-spacing: 0.3px; }
    h2 { margin: 0 0 10px; font-size: 18px; }
    .muted { color: var(--muted); font-size: 13px; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    input, textarea {
      width: 100%;
      border: 1px solid #d8cebe;
      border-radius: 10px;
      padding: 10px;
      background: #fffcf7;
      font: inherit;
    }
    button {
      border: none;
      border-radius: 10px;
      background: var(--accent);
      color: #fff;
      padding: 9px 14px;
      cursor: pointer;
      font: inherit;
    }
    button.alt { background: #2f3a46; }
    button.warn { background: var(--warn); }
    .pill {
      display: inline-block;
      padding: 5px 9px;
      border-radius: 999px;
      background: #e7f5f3;
      color: #0f6e7f;
      font-size: 12px;
      margin-right: 6px;
      margin-bottom: 6px;
    }
    pre {
      margin: 0;
      padding: 10px;
      border-radius: 10px;
      background: #101820;
      color: #d7e2ef;
      overflow: auto;
      font-size: 12px;
    }
    .ok { color: var(--ok); }
    .err { color: var(--warn); }
  </style>
</head>
<body>
  <h1>VPN Resource Kill-Switch</h1>
  <div class="muted">Generic resource guard with country/server policy. Default profile: antigravity.</div>

  <div class="grid" style="margin-top: 16px;">
    <section class="card">
      <h2>Runtime</h2>
      <div id="runtime"></div>
      <div class="row">
        <button onclick="runApply()">Apply Rules</button>
        <button class="alt" onclick="runProbe()">Probe</button>
      </div>
      <div id="probe" style="margin-top:8px;"></div>
    </section>

    <section class="card">
      <h2>Add / Update Resource</h2>
      <label>Name</label>
      <input id="name" placeholder="netflix">
      <label>Domains (one per line)</label>
      <textarea id="domains" rows="5" placeholder="netflix.com\nnflxvideo.net"></textarea>
      <label>Required Country (optional)</label>
      <input id="country" placeholder="US">
      <label>Required Server/IP/ISP match (optional)</label>
      <input id="server" placeholder="198.51.100.4 or m247">
      <label>Allowed Country Codes (optional, comma-separated)</label>
      <input id="allowCountries" placeholder="US,DE,FR">
      <label>Blocked Country Codes (optional, comma-separated)</label>
      <input id="blockCountries" placeholder="RU,IR,KP">
      <div class="row">
        <button onclick="addResource(false)">Add</button>
        <button class="alt" onclick="addResource(true)">Replace</button>
      </div>
    </section>

    <section class="card">
      <h2>Resources</h2>
      <div id="resources"></div>
    </section>

    <section class="card">
      <h2>Last State</h2>
      <pre id="state">loading...</pre>
    </section>
  </div>

  <script>
    async function api(path, opts={}) {
      const res = await fetch(path, Object.assign({
        headers: {'Content-Type': 'application/json'}
      }, opts));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || ('HTTP ' + res.status));
      }
      return data;
    }

    function showRuntime(status) {
      const c = status.config || {};
      const html = [
        '<div><b>VPN IF:</b> ' + (c.vpn_interface || '-') + '</div>',
        '<div><b>VPN up:</b> ' + status.vpn_up + '</div>',
        '<div><b>nft table:</b> ' + status.nft_table_present + '</div>',
        '<div><b>timer:</b> ' + status.timer_enabled + ' / ' + status.timer_active + '</div>'
      ].join('');
      document.getElementById('runtime').innerHTML = html;
    }

    function renderResources(items) {
      const box = document.getElementById('resources');
      if (!items.length) {
        box.innerHTML = '<div class="muted">no resources</div>';
        return;
      }
      box.innerHTML = items.map(item => {
        const policy = item.policy || {};
        const badges = [
          '<span class="pill">' + item.name + '</span>',
          '<span class="pill">domains: ' + item.domains.length + '</span>',
          policy.required_country ? '<span class="pill">country=' + policy.required_country + '</span>' : '',
          policy.required_server ? '<span class="pill">server~=' + policy.required_server + '</span>' : '',
          (policy.allowed_countries || []).length ? '<span class="pill">allow=' + policy.allowed_countries.join('/') + '</span>' : '',
          (policy.blocked_countries || []).length ? '<span class="pill">block=' + policy.blocked_countries.join('/') + '</span>' : ''
        ].join('');
        return '<div style="margin-bottom:12px;">'
          + badges
          + '<div class="muted">' + item.domains.join(', ') + '</div>'
          + '<div class="row"><button class="warn" onclick="removeResource(\\'' + item.name + '\\')">Remove</button></div>'
          + '</div>';
      }).join('');
    }

    async function refresh() {
      try {
        const status = await api('/api/status');
        showRuntime(status);
        renderResources(status.resources || []);
        document.getElementById('state').textContent = JSON.stringify(status.state || {}, null, 2);
      } catch (e) {
        document.getElementById('state').textContent = 'Error: ' + e.message;
      }
    }

    async function runApply() {
      try {
        await api('/api/apply', {method: 'POST', body: '{}'});
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    }

    async function runProbe() {
      try {
        const out = await api('/api/probe', {method: 'POST', body: '{}'});
        const ok = out.passed ? '<span class="ok">PASS</span>' : '<span class="err">FAIL</span>';
        document.getElementById('probe').innerHTML = 'Probe: ' + ok + ' (' + out.expected_mode + ')';
      } catch (e) {
        alert(e.message);
      }
    }

    async function addResource(replace) {
      const allowCountries = document.getElementById('allowCountries').value
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);
      const blockCountries = document.getElementById('blockCountries').value
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);
      const payload = {
        name: document.getElementById('name').value.trim(),
        domains: document.getElementById('domains').value.split(/\\n+/).map(x => x.trim()).filter(Boolean),
        required_country: document.getElementById('country').value.trim() || null,
        required_server: document.getElementById('server').value.trim() || null,
        allowed_countries: allowCountries,
        blocked_countries: blockCountries,
        replace
      };
      try {
        await api('/api/resource/add', {method: 'POST', body: JSON.stringify(payload)});
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    }

    async function removeResource(name) {
      try {
        await api('/api/resource/remove', {method: 'POST', body: JSON.stringify({name})});
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    }

    refresh();
  </script>
</body>
</html>
"""


def _serialize_config(config: AppConfig) -> dict[str, Any]:
    return {
        "version": config.version,
        "vpn_interface": config.vpn_interface,
        "resources": [
            {
                "name": resource.name,
                "domains": resource.domains,
                "enabled": resource.enabled,
                "policy": {
                    "required_country": resource.policy.required_country,
                    "required_server": resource.policy.required_server,
                    "allowed_countries": resource.policy.allowed_countries or [],
                    "blocked_countries": resource.policy.blocked_countries or [],
                },
            }
            for resource in config.resources
        ],
    }


def _json_response(handler: BaseHTTPRequestHandler, payload: Any, status: int = 200) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def launch_gui(service: KillSwitchService, host: str, port: int) -> None:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path == "/":
                body = PAGE_HTML.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            if path == "/api/status":
                try:
                    status = service.status()
                    payload = {
                        "config": _serialize_config(status["config"]),
                        "vpn_up": status["vpn_up"],
                        "nft_table_present": status["nft_table_present"],
                        "timer_enabled": status["timer_enabled"],
                        "timer_active": status["timer_active"],
                        "state": status["state"],
                        "resources": service.list_resources(),
                    }
                    _json_response(self, payload)
                except Exception as exc:  # noqa: BLE001
                    _json_response(self, {"error": str(exc)}, status=500)
                return

            _json_response(self, {"error": "not found"}, status=404)

        def do_POST(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            content_len = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_len) if content_len > 0 else b"{}"
            data = json.loads(raw.decode("utf-8") or "{}")

            try:
                if path == "/api/apply":
                    report = service.apply()
                    _json_response(self, report)
                    return

                if path == "/api/probe":
                    report = service.probe(
                        resource_name=data.get("resource_name"),
                        domain=data.get("domain"),
                        non_vpn_interface=data.get("non_vpn_interface"),
                        timeout=int(data.get("timeout") or 8),
                    )
                    _json_response(self, report)
                    return

                if path == "/api/resource/add":
                    service.add_resource(
                        name=str(data["name"]),
                        domains=[str(x) for x in data["domains"]],
                        required_country=data.get("required_country"),
                        required_server=data.get("required_server"),
                        allowed_countries=[str(x) for x in (data.get("allowed_countries") or [])],
                        blocked_countries=[str(x) for x in (data.get("blocked_countries") or [])],
                        replace=bool(data.get("replace", False)),
                    )
                    _json_response(self, {"ok": True})
                    return

                if path == "/api/resource/remove":
                    service.remove_resource(str(data["name"]))
                    _json_response(self, {"ok": True})
                    return
            except CLIError as exc:
                _json_response(self, {"error": str(exc)}, status=400)
                return
            except Exception as exc:  # noqa: BLE001
                _json_response(self, {"error": str(exc)}, status=500)
                return

            _json_response(self, {"error": "not found"}, status=404)

        def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
            return

    server = ThreadingHTTPServer((host, port), Handler)
    print(f"GUI running: http://{host}:{port}")
    server.serve_forever()
