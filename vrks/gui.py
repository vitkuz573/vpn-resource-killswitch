from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from .errors import CLIError
from .mitm_ca import ensure_local_ca, local_ca_status, trust_local_ca
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
  <div class="muted">Generic resource guard with policy profiles and presets.</div>

  <div class="grid" style="margin-top: 16px;">
    <section class="card">
      <h2>Runtime</h2>
      <div id="runtime"></div>
      <div class="row">
        <button onclick="runApply()">Apply Rules</button>
        <button class="alt" onclick="runProbe()">Probe</button>
        <button onclick="bootstrapPreset()">Bootstrap Preset</button>
        <button class="alt" onclick="runSync()">Sync Full</button>
      </div>
      <div id="probe" style="margin-top:8px;"></div>
      <label style="margin-top:10px; display:block;">Preset Name</label>
      <input id="bootstrapPreset" placeholder="preset name">
      <label style="margin-top:10px; display:block;">Access Check Resource</label>
      <input id="checkResource" placeholder="resource name">
      <div class="row">
        <label><input id="checkAllDomains" type="checkbox"> all domains</label>
        <button class="alt" onclick="runAccessCheck()">Access Check</button>
      </div>
      <div id="accessResult" style="margin-top:8px;"></div>
      <label style="margin-top:10px; display:block;">Discover Resource</label>
      <input id="discoverResource" placeholder="resource name">
      <div class="row">
        <input id="discoverDepth" type="number" min="0" max="5" value="2" style="width:90px;">
        <label><input id="discoverExternal" type="checkbox"> include external</label>
      </div>
      <div class="row">
        <button class="alt" onclick="runDiscover()">Discover Domains</button>
        <button onclick="runAutofill()">Autofill Domains</button>
      </div>
      <div id="discoverResult" style="margin-top:8px;"></div>
      <label style="margin-top:12px; display:block;">Runtime Capture Command</label>
      <input id="runtimeCmd" placeholder="/path/to/your/app --flags">
      <label style="margin-top:10px; display:block;">Run Command As User (optional)</label>
      <input id="runtimeUser" placeholder="vitaly">
      <div class="row">
        <input id="runtimeDuration" type="number" min="5" max="1800" value="60" style="width:90px;">
        <input id="runtimeStartupDelay" type="number" min="0" max="300" step="0.5" value="2" style="width:110px;">
      </div>
      <label style="margin-top:10px; display:block;">Runtime Include Regex (comma-separated)</label>
      <input id="runtimeInclude" placeholder="service|cdn|api|googleapis|cloudfront">
      <label style="margin-top:10px; display:block;">Runtime Exclude Regex (comma-separated)</label>
      <input id="runtimeExclude" placeholder="microsoft\\.com|cloudapp\\.azure\\.com|localhost|127\\.0\\.0\\.1">
      <div class="row">
        <button class="alt" onclick="runRuntimeDiscover()">Runtime Discover</button>
        <button onclick="runRuntimeAutofill()">Runtime Autofill</button>
      </div>
      <div id="runtimeResult" style="margin-top:8px;"></div>
      <h2 style="margin-top:14px;">HTTPS Block Page (MITM)</h2>
      <div id="mitmStatus" class="muted"></div>
      <label style="margin-top:10px; display:block;">CA Common Name</label>
      <input id="caCommonName" placeholder="VRKS Local MITM CA">
      <div class="row">
        <button class="alt" onclick="runCaStatus()">CA Status</button>
        <button onclick="runCaInit()">Init CA</button>
        <button class="alt" onclick="runCaTrust()">Trust CA</button>
      </div>
      <div id="mitmResult" style="margin-top:8px;"></div>
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
      <label>Blocked Context Keywords (optional, comma-separated)</label>
      <input id="blockContext" placeholder="crimea,donetsk,luhansk">
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
      const ca = status.local_ca || {};
      const html = [
        '<div><b>VPN IF:</b> ' + (c.vpn_interface || '-') + '</div>',
        '<div><b>VPN up:</b> ' + status.vpn_up + '</div>',
        '<div><b>nft table:</b> ' + status.nft_table_present + '</div>',
        '<div><b>nft nat table:</b> ' + status.nft_nat_table_present + '</div>',
        '<div><b>timer:</b> ' + status.timer_enabled + ' / ' + status.timer_active + '</div>',
        '<div><b>watch:</b> ' + status.watch_enabled + ' / ' + status.watch_active + '</div>',
        '<div><b>blockpage:</b> ' + status.blockpage_enabled + ' / ' + status.blockpage_active + '</div>',
        '<div><b>blockpage-tls:</b> ' + status.tls_blockpage_enabled + ' / ' + status.tls_blockpage_active + '</div>'
      ].join('');
      document.getElementById('runtime').innerHTML = html;
      document.getElementById('mitmStatus').textContent =
        'Local CA exists: ' + !!ca.exists
        + ' | cert: ' + (ca.ca_cert_path || '-');
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
          (policy.blocked_countries || []).length ? '<span class="pill">block=' + policy.blocked_countries.join('/') + '</span>' : '',
          (policy.blocked_context_keywords || []).length ? '<span class="pill">ctx=' + policy.blocked_context_keywords.join('/') + '</span>' : ''
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
        if (!document.getElementById('bootstrapPreset').value.trim()) {
          const presets = await api('/api/presets');
          if (presets.length) {
            document.getElementById('bootstrapPreset').value = presets[0].name;
          }
        }
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

    async function bootstrapPreset() {
      try {
        const presetName = document.getElementById('bootstrapPreset').value.trim();
        if (!presetName) {
          alert('Preset name is required');
          return;
        }
        const out = await api('/api/bootstrap', {method: 'POST', body: JSON.stringify({preset_name: presetName, timeout: 8})});
        const ok = out.verify && out.verify.passed ? '<span class="ok">PASS</span>' : '<span class="err">FAIL</span>';
        document.getElementById('probe').innerHTML = 'Bootstrap ' + presetName + ': ' + ok;
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    }

    async function runAccessCheck() {
      try {
        const resourceName = document.getElementById('checkResource').value.trim();
        if (!resourceName) {
          alert('Resource name is required');
          return;
        }
        const payload = {
          resource_name: resourceName,
          timeout: 8,
          all_domains: document.getElementById('checkAllDomains').checked
        };
        const out = await api('/api/access-check', {method: 'POST', body: JSON.stringify(payload)});
        const ok = out.access_ok ? '<span class="ok">PASS</span>' : '<span class="err">FAIL</span>';
        if (out.all_domains) {
          document.getElementById('accessResult').innerHTML =
            'Access: ' + ok
            + ' (all domains, checked=' + out.domains_checked
            + ', failed=' + out.failed_domains.length + ')';
        } else {
          document.getElementById('accessResult').innerHTML =
            'Access: ' + ok
            + ' (mode=' + out.expected_mode
            + ', vpn=' + out.vpn_reachable
            + ', non-vpn-block=' + out.non_vpn_blocked + ')';
        }
      } catch (e) {
        alert(e.message);
      }
    }

    async function runSync() {
      try {
        const resourceName = document.getElementById('checkResource').value.trim();
        const payload = {
          resources: resourceName ? [resourceName] : null,
          max_depth: parseInt(document.getElementById('discoverDepth').value || '2', 10),
          include_external: document.getElementById('discoverExternal').checked,
          dns_check: true,
          run_apply: true,
          verify_timeout: 8,
          check_access: true,
          access_timeout: 8,
          access_all_domains: document.getElementById('checkAllDomains').checked
        };
        const out = await api('/api/sync', {method: 'POST', body: JSON.stringify(payload)});
        const ok = out.passed ? '<span class="ok">PASS</span>' : '<span class="err">FAIL</span>';
        document.getElementById('probe').innerHTML =
          'Sync: ' + ok
          + ' (changed_resources=' + out.changed_resources
          + ', added_domains=' + out.added_domains_total + ')';
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    }

    async function runDiscover() {
      try {
        const resourceName = document.getElementById('discoverResource').value.trim()
          || document.getElementById('checkResource').value.trim();
        if (!resourceName) {
          alert('Discover resource name is required');
          return;
        }
        const payload = {
          resource_name: resourceName,
          max_depth: parseInt(document.getElementById('discoverDepth').value || '2', 10),
          include_external: document.getElementById('discoverExternal').checked,
          dns_check: true
        };
        const out = await api('/api/discover', {method: 'POST', body: JSON.stringify(payload)});
        document.getElementById('discoverResult').innerHTML =
          'Discovered ' + out.domains.length + ' domains, new=' + out.new_domains.length
          + ', unresolved=' + out.unresolved_domains.length;
      } catch (e) {
        alert(e.message);
      }
    }

    async function runAutofill() {
      try {
        const resourceName = document.getElementById('discoverResource').value.trim()
          || document.getElementById('checkResource').value.trim();
        if (!resourceName) {
          alert('Autofill resource name is required');
          return;
        }
        const payload = {
          resource_name: resourceName,
          max_depth: parseInt(document.getElementById('discoverDepth').value || '2', 10),
          include_external: document.getElementById('discoverExternal').checked,
          dns_check: true,
          run_apply: true
        };
        const out = await api('/api/resource/autofill', {method: 'POST', body: JSON.stringify(payload)});
        document.getElementById('discoverResult').innerHTML =
          'Autofill: changed=' + out.changed + ', added=' + out.new_domains.length + ', total=' + out.domains_total;
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    }

    function parseCsv(value) {
      return value
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);
    }

    async function runRuntimeDiscover() {
      try {
        const runtimeCmd = document.getElementById('runtimeCmd').value.trim();
        if (!runtimeCmd) {
          alert('Runtime command is required');
          return;
        }
        const payload = {
          command: runtimeCmd,
          command_user: document.getElementById('runtimeUser').value.trim() || null,
          duration: parseInt(document.getElementById('runtimeDuration').value || '60', 10),
          startup_delay: parseFloat(document.getElementById('runtimeStartupDelay').value || '2'),
          capture_interface: 'any',
          include_patterns: parseCsv(document.getElementById('runtimeInclude').value),
          exclude_patterns: parseCsv(document.getElementById('runtimeExclude').value)
        };
        const out = await api('/api/runtime/discover', {method: 'POST', body: JSON.stringify(payload)});
        document.getElementById('runtimeResult').innerHTML =
          'Runtime discover: domains=' + out.domains_count
          + ', capture_lines=' + out.capture_lines
          + ', timed_out=' + out.command_timed_out;
      } catch (e) {
        alert(e.message);
      }
    }

    async function runRuntimeAutofill() {
      try {
        const runtimeCmd = document.getElementById('runtimeCmd').value.trim();
        if (!runtimeCmd) {
          alert('Runtime command is required');
          return;
        }
        const resourceName = document.getElementById('discoverResource').value.trim()
          || document.getElementById('checkResource').value.trim();
        if (!resourceName) {
          alert('Resource name is required for runtime autofill');
          return;
        }
        const payload = {
          command: runtimeCmd,
          command_user: document.getElementById('runtimeUser').value.trim() || null,
          duration: parseInt(document.getElementById('runtimeDuration').value || '60', 10),
          startup_delay: parseFloat(document.getElementById('runtimeStartupDelay').value || '2'),
          capture_interface: 'any',
          include_patterns: parseCsv(document.getElementById('runtimeInclude').value),
          exclude_patterns: parseCsv(document.getElementById('runtimeExclude').value),
          run_apply: true
        };
        const out = await api('/api/resource/runtime-autofill', {
          method: 'POST',
          body: JSON.stringify(Object.assign({resource_name: resourceName}, payload))
        });
        document.getElementById('runtimeResult').innerHTML =
          'Runtime autofill: changed=' + out.changed
          + ', added=' + out.new_domains.length
          + ', total=' + out.domains_total;
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    }

    async function runCaStatus() {
      try {
        const out = await api('/api/mitm/ca-status');
        document.getElementById('mitmResult').innerHTML =
          'CA exists=' + !!out.exists
          + ', cert=' + (out.ca_cert_path || '-');
      } catch (e) {
        alert(e.message);
      }
    }

    async function runCaInit() {
      try {
        const commonName = document.getElementById('caCommonName').value.trim() || 'VRKS Local MITM CA';
        const out = await api('/api/mitm/ca-init', {
          method: 'POST',
          body: JSON.stringify({common_name: commonName})
        });
        document.getElementById('mitmResult').innerHTML =
          'CA init: created=' + !!out.created + ', cert=' + (out.ca_cert_path || '-');
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    }

    async function runCaTrust() {
      try {
        const out = await api('/api/mitm/ca-trust', {method: 'POST', body: '{}'});
        document.getElementById('mitmResult').innerHTML =
          'CA trusted via ' + (out.method || '-') + ' (' + (out.target || '-') + ')';
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
        blocked_context_keywords: document.getElementById('blockContext').value
          .split(',')
          .map(x => x.trim())
          .filter(Boolean),
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
                    "blocked_context_keywords": resource.policy.blocked_context_keywords or [],
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
                        "nft_nat_table_present": status["nft_nat_table_present"],
                        "timer_enabled": status["timer_enabled"],
                        "timer_active": status["timer_active"],
                        "watch_enabled": status["watch_enabled"],
                        "watch_active": status["watch_active"],
                        "blockpage_enabled": status["blockpage_enabled"],
                        "blockpage_active": status["blockpage_active"],
                        "tls_blockpage_enabled": status["tls_blockpage_enabled"],
                        "tls_blockpage_active": status["tls_blockpage_active"],
                        "local_ca": status["local_ca"],
                        "state": status["state"],
                        "resources": service.list_resources(),
                    }
                    _json_response(self, payload)
                except Exception as exc:  # noqa: BLE001
                    _json_response(self, {"error": str(exc)}, status=500)
                return

            if path == "/api/mitm/ca-status":
                try:
                    _json_response(self, local_ca_status())
                except Exception as exc:  # noqa: BLE001
                    _json_response(self, {"error": str(exc)}, status=500)
                return

            if path == "/api/presets":
                try:
                    _json_response(self, service.list_presets())
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

                if path == "/api/mitm/ca-init":
                    report = ensure_local_ca(common_name=str(data.get("common_name") or "VRKS Local MITM CA"))
                    _json_response(self, report)
                    return

                if path == "/api/mitm/ca-trust":
                    report = trust_local_ca()
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

                if path == "/api/access-check":
                    report = service.access_check(
                        resource_name=str(data.get("resource_name") or ""),
                        domain=data.get("domain"),
                        timeout=int(data.get("timeout") or 8),
                        all_domains=bool(data.get("all_domains", False)),
                    )
                    _json_response(self, report)
                    return

                if path == "/api/bootstrap":
                    report = service.bootstrap(
                        preset_name=str(data.get("preset_name") or ""),
                        vpn_interface=data.get("vpn_interface"),
                        install_bin=bool(data.get("install_bin", False)),
                        timeout=int(data.get("timeout") or 8),
                        autodiscover=bool(data.get("autodiscover", True)),
                        discovery_depth=int(data.get("discovery_depth") or 2),
                        include_external=bool(data.get("include_external", False)),
                    )
                    _json_response(self, report)
                    return

                if path == "/api/discover":
                    if not data.get("resource_name"):
                        raise CLIError("resource_name is required.")
                    report = service.discover_resource_domains(
                        resource_name=str(data["resource_name"]),
                        max_depth=int(data.get("max_depth") or 2),
                        include_external=bool(data.get("include_external", False)),
                        dns_check=bool(data.get("dns_check", True)),
                    )
                    _json_response(self, report)
                    return

                if path == "/api/resource/autofill":
                    if not data.get("resource_name"):
                        raise CLIError("resource_name is required.")
                    report = service.autofill_resource_domains(
                        resource_name=str(data["resource_name"]),
                        max_depth=int(data.get("max_depth") or 2),
                        include_external=bool(data.get("include_external", False)),
                        dns_check=bool(data.get("dns_check", True)),
                        run_apply=bool(data.get("run_apply", True)),
                    )
                    _json_response(self, report)
                    return

                if path == "/api/sync":
                    report = service.sync(
                        resources=[str(x) for x in (data.get("resources") or [])] or None,
                        max_depth=int(data.get("max_depth") or 2),
                        include_external=bool(data.get("include_external", False)),
                        dns_check=bool(data.get("dns_check", True)),
                        run_apply=bool(data.get("run_apply", True)),
                        verify_timeout=int(data.get("verify_timeout") or 8),
                        check_access=bool(data.get("check_access", True)),
                        access_timeout=int(data.get("access_timeout") or 8),
                        access_all_domains=bool(data.get("access_all_domains", False)),
                    )
                    _json_response(self, report)
                    return

                if path == "/api/runtime/discover":
                    report = service.runtime_discover(
                        command=str(data.get("command") or ""),
                        command_user=(str(data.get("command_user") or "").strip() or None),
                        duration=int(data.get("duration") or 60),
                        startup_delay=float(data.get("startup_delay") or 2.0),
                        capture_interface=str(data.get("capture_interface") or "any"),
                        include_patterns=[str(x) for x in (data.get("include_patterns") or [])],
                        exclude_patterns=[str(x) for x in (data.get("exclude_patterns") or [])],
                    )
                    _json_response(self, report)
                    return

                if path == "/api/resource/runtime-autofill":
                    if not data.get("resource_name"):
                        raise CLIError("resource_name is required.")
                    report = service.runtime_autofill_resource(
                        resource_name=str(data["resource_name"]),
                        command=str(data.get("command") or ""),
                        command_user=(str(data.get("command_user") or "").strip() or None),
                        duration=int(data.get("duration") or 60),
                        startup_delay=float(data.get("startup_delay") or 2.0),
                        capture_interface=str(data.get("capture_interface") or "any"),
                        include_patterns=[str(x) for x in (data.get("include_patterns") or [])],
                        exclude_patterns=[str(x) for x in (data.get("exclude_patterns") or [])],
                        run_apply=bool(data.get("run_apply", True)),
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
                        blocked_context_keywords=[
                            str(x) for x in (data.get("blocked_context_keywords") or [])
                        ],
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
