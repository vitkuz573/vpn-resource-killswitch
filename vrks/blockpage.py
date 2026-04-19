from __future__ import annotations

import html
import json
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from . import storage
from .network import normalize_domain, normalize_resource_name


GUI_URL = "http://127.0.0.1:8877/"


def _resource_for_host(host: str) -> str | None:
    try:
        config = storage.load_config()
    except Exception:
        return None

    host_value = host.strip().lower()
    if not host_value:
        return None

    for resource in config.resources:
        if not resource.enabled:
            continue
        for domain in resource.domains:
            current = domain.strip().lower()
            if not current:
                continue
            if host_value == current or host_value.endswith(f".{current}"):
                return normalize_resource_name(resource.name)
    return None


def _state_for_resource(resource_name: str | None) -> tuple[str | None, str | None]:
    if not resource_name:
        return None, None
    state = storage.load_state() or {}
    resources = state.get("resources") or {}
    current = resources.get(resource_name) or {}
    mode = current.get("mode")
    reason = current.get("reason")
    return (str(mode) if mode else None, str(reason) if reason else None)


def _sanitize_host(raw_host: str) -> str:
    host = (raw_host or "").strip()
    if not host:
        return ""
    if ":" in host:
        host = host.split(":", 1)[0]
    try:
        return normalize_domain(host)
    except Exception:
        return host.lower()


def _humanize_mode(mode: str | None) -> str:
    value = (mode or "").strip().lower()
    if value == "hard_block":
        return "hard_block: blocked on all interfaces"
    if value == "vpn_only":
        return "vpn_only: allowed only through VPN interface"
    if not value:
        return "blocked"
    return value


def _humanize_reason(reason: str | None) -> str:
    value = (reason or "").strip()
    if not value:
        return "Blocked by policy or VPN state."

    direct_map = {
        "policy_match": "Policy matched, but request still went through a blocked path.",
        "no_policy_constraints": "No policy constraints configured for this resource.",
        "vpn_context_unavailable": "VPN context is unavailable, so safe fallback is active.",
        "country_code_unavailable_for_allowed_policy": "Country code unavailable for allowed_countries check.",
        "country_code_unavailable_for_blocked_policy": "Country code unavailable for blocked_countries check.",
    }
    if value in direct_map:
        return direct_map[value]

    if value.startswith("country_not_allowed(current=") and value.endswith(")"):
        current = value[len("country_not_allowed(current=") : -1]
        return f"Current country '{current}' is not in allowed_countries."

    if value.startswith("country_blocked(current=") and value.endswith(")"):
        current = value[len("country_blocked(current=") : -1]
        return f"Current country '{current}' is in blocked_countries."

    if value.startswith("country_mismatch(expected=") and value.endswith(")"):
        expected = value[len("country_mismatch(expected=") : -1]
        return f"VPN country does not match required_country '{expected}'."

    if value.startswith("server_mismatch(expected~=") and value.endswith(")"):
        expected = value[len("server_mismatch(expected~=") : -1]
        return f"VPN server/ISP/org does not match required_server pattern '{expected}'."

    if value.startswith("context_keyword_blocked(keyword=") and value.endswith(")"):
        keyword = value[len("context_keyword_blocked(keyword=") : -1]
        return f"VPN context contains blocked keyword '{keyword}'."

    return f"Policy trigger: {value}"


def _build_diagnostics(
    *,
    host: str,
    path: str,
    resource: str | None,
    mode: str | None,
    reason: str | None,
    transport: str,
    user_agent: str,
) -> str:
    payload = {
        "observed_at_utc": datetime.now(UTC).isoformat(),
        "transport": transport,
        "host": host or "unknown",
        "path": path or "/",
        "resource": resource or "unknown",
        "mode": mode or "blocked",
        "reason": reason or "policy_or_vpn_block",
        "mode_summary": _humanize_mode(mode),
        "reason_summary": _humanize_reason(reason),
        "user_agent": (user_agent or "").strip()[:220],
    }
    return json.dumps(payload, indent=2, ensure_ascii=False)


def _blocked_page_html(
    *,
    host: str,
    path: str,
    resource: str | None,
    mode: str | None,
    reason: str | None,
    transport: str = "http",
    user_agent: str = "",
) -> str:
    host_text = html.escape(host or "unknown")
    path_text = html.escape(path or "/")
    resource_text = html.escape(resource or "unknown")
    mode_text = html.escape(mode or "blocked")
    reason_text = html.escape(reason or "policy_or_vpn_block")

    transport_value = (transport or "http").strip().lower()
    transport_badge = "HTTPS MITM" if transport_value == "https" else "HTTP redirect"
    note_text = (
        "This HTTPS page is served by local VRKS TLS block-page service."
        if transport_value == "https"
        else "This HTTP page is served by local VRKS block-page service."
    )
    note_text = html.escape(note_text)

    mode_summary = html.escape(_humanize_mode(mode))
    reason_summary = html.escape(_humanize_reason(reason))
    diagnostics_json = html.escape(
        _build_diagnostics(
            host=host,
            path=path,
            resource=resource,
            mode=mode,
            reason=reason,
            transport=transport_value,
            user_agent=user_agent,
        )
    )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VRKS Blocked Resource</title>
  <style>
    :root {{
      --bg: #f4f0e6;
      --bg-soft: #f9f6ef;
      --panel: #fffdf9;
      --ink: #1d2430;
      --muted: #606c7b;
      --accent: #c74f22;
      --accent-2: #0f6d75;
      --line: #e7ddce;
      --chip: #f3e7d9;
      --ok: #0f6d75;
      --shadow: 0 20px 50px rgba(52, 38, 15, 0.14);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(900px 520px at 10% -5%, #f9d8b8 0%, transparent 65%),
        radial-gradient(850px 500px at 110% 0%, #cfe9e6 0%, transparent 70%),
        linear-gradient(180deg, var(--bg) 0%, var(--bg-soft) 100%);
      color: var(--ink);
      font: 16px/1.5 "Manrope", "IBM Plex Sans", "Segoe UI", sans-serif;
      padding: 24px;
      display: grid;
      place-items: center;
    }}
    .panel {{
      width: min(900px, 100%);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      overflow: hidden;
      animation: enter .45s ease-out both;
    }}
    @keyframes enter {{
      from {{ opacity: 0; transform: translateY(14px); }}
      to {{ opacity: 1; transform: translateY(0); }}
    }}
    .head {{
      padding: 22px 24px 16px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(130deg, #fff4e8, #edf8f6);
    }}
    .badge {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 5px 11px;
      border-radius: 999px;
      background: var(--chip);
      color: var(--accent);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: .04em;
      text-transform: uppercase;
    }}
    h1 {{
      margin: 12px 0 6px;
      font-size: clamp(26px, 3.4vw, 38px);
      line-height: 1.12;
      letter-spacing: -.02em;
    }}
    .lead {{ margin: 0; color: var(--muted); max-width: 72ch; }}
    .body {{ padding: 20px 24px 24px; display: grid; gap: 16px; }}
    .body > * {{ min-width: 0; }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
      margin: 0;
      min-width: 0;
    }}
    .item {{
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 10px 12px;
      background: #fff;
    }}
    .item dt {{
      margin: 0 0 4px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: var(--muted);
    }}
    .item dd {{ margin: 0; font-weight: 600; word-break: break-word; }}
    .mono {{
      font-family: "IBM Plex Mono", "JetBrains Mono", "Cascadia Mono", monospace;
      font-size: 13px;
      color: #18202c;
      background: #f6f1e8;
      border-radius: 8px;
      padding: 3px 6px;
      display: inline-block;
      max-width: 100%;
      overflow-wrap: anywhere;
    }}
    .summary {{
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fff;
      padding: 12px;
    }}
    .summary p {{ margin: 0 0 8px; }}
    .summary p:last-child {{ margin-bottom: 0; }}
    .summary strong {{ color: var(--accent-2); }}
    .actions {{ display: flex; gap: 10px; flex-wrap: wrap; }}
    .btn {{
      border: none;
      border-radius: 11px;
      padding: 9px 14px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform .14s ease, opacity .14s ease;
    }}
    .btn:hover {{ transform: translateY(-1px); }}
    .btn:active {{ transform: translateY(0); }}
    .btn-primary {{ background: var(--accent); color: #fff; }}
    .btn-secondary {{ background: #263242; color: #fff; }}
    .btn-ghost {{
      background: transparent;
      color: var(--ink);
      border: 1px solid var(--line);
    }}
    .status {{ min-height: 20px; margin: 2px 0 0; color: var(--ok); font-size: 14px; }}
    details {{
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fff;
      padding: 10px 12px;
      min-width: 0;
    }}
    summary {{
      cursor: pointer;
      font-weight: 700;
      color: #2b3443;
      outline: none;
    }}
    pre {{
      margin: 10px 0 0;
      overflow: auto;
      max-width: 100%;
      min-width: 0;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      background: #141e2a;
      color: #dbe8f7;
      border-radius: 10px;
      padding: 12px;
      font: 12px/1.45 "IBM Plex Mono", "JetBrains Mono", monospace;
    }}
    .foot {{
      margin-top: 2px;
      color: var(--muted);
      font-size: 14px;
      border-top: 1px dashed var(--line);
      padding-top: 12px;
    }}
    .foot strong {{ color: var(--accent-2); }}
    @media (max-width: 640px) {{
      body {{ padding: 12px; }}
      .head, .body {{ padding-left: 14px; padding-right: 14px; }}
      .actions {{ flex-direction: column; }}
      .btn {{ width: 100%; }}
    }}
  </style>
</head>
<body>
  <article class="panel">
    <header class="head">
      <span class="badge">Blocked by VRKS · {html.escape(transport_badge)}</span>
      <h1>Resource blocked by VPN policy</h1>
      <p class="lead">Your request was intercepted to prevent unintended access outside configured VPN conditions.</p>
    </header>

    <section class="body">
      <dl class="grid">
        <div class="item">
          <dt>Host</dt>
          <dd><span class="mono">{host_text}</span></dd>
        </div>
        <div class="item">
          <dt>Path</dt>
          <dd><span class="mono">{path_text}</span></dd>
        </div>
        <div class="item">
          <dt>Resource Profile</dt>
          <dd><span class="mono">{resource_text}</span></dd>
        </div>
        <div class="item">
          <dt>Mode</dt>
          <dd><span class="mono">{mode_text}</span></dd>
        </div>
        <div class="item">
          <dt>Reason Code</dt>
          <dd><span class="mono">{reason_text}</span></dd>
        </div>
      </dl>

      <div class="summary">
        <p><strong>Mode summary:</strong> {mode_summary}</p>
        <p><strong>Reason summary:</strong> {reason_summary}</p>
      </div>

      <div class="actions">
        <button class="btn btn-primary" onclick="window.location.reload()">Retry Request</button>
        <a class="btn btn-secondary" href="{html.escape(GUI_URL)}" target="_blank" rel="noopener">Open VRKS GUI</a>
        <button class="btn btn-ghost" onclick="copyDiagnostics()">Copy Diagnostics</button>
      </div>
      <p id="status" class="status" aria-live="polite"></p>

      <details>
        <summary>Technical Diagnostics</summary>
        <pre id="diagnostics">{diagnostics_json}</pre>
      </details>

      <p class="foot"><strong>Note:</strong> {note_text}</p>
    </section>
  </article>

  <script>
    async function copyDiagnostics() {{
      const status = document.getElementById('status');
      const text = document.getElementById('diagnostics').textContent || '';
      try {{
        if (navigator.clipboard && navigator.clipboard.writeText) {{
          await navigator.clipboard.writeText(text);
          status.textContent = 'Diagnostics copied to clipboard.';
        }} else {{
          throw new Error('clipboard_unavailable');
        }}
      }} catch (_e) {{
        status.textContent = 'Clipboard access unavailable. Copy manually from Technical Diagnostics.';
      }}
    }}
  </script>
</body>
</html>
"""


def _build_block_body(
    *,
    raw_path: str,
    raw_host: str,
    user_agent: str,
    transport: str,
) -> bytes:
    parsed = urlparse(raw_path)
    request_host = _sanitize_host(raw_host)
    resource_name = _resource_for_host(request_host)
    mode, reason = _state_for_resource(resource_name)
    return _blocked_page_html(
        host=request_host,
        path=parsed.path or "/",
        resource=resource_name,
        mode=mode,
        reason=reason,
        transport=transport,
        user_agent=user_agent,
    ).encode("utf-8")


def _send_block_headers(handler: BaseHTTPRequestHandler, *, content_length: int) -> None:
    handler.send_response(451)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(content_length))
    handler.send_header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0")
    handler.send_header("Pragma", "no-cache")
    handler.send_header("Expires", "0")
    handler.send_header("X-Robots-Tag", "noindex, nofollow")
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.send_header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
    )
    handler.end_headers()


def run_blockpage_server(*, host: str, port: int) -> None:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            body = _build_block_body(
                raw_path=self.path,
                raw_host=self.headers.get("Host", ""),
                user_agent=self.headers.get("User-Agent", ""),
                transport="http",
            )
            _send_block_headers(self, content_length=len(body))
            self.wfile.write(body)

        def do_HEAD(self) -> None:  # noqa: N802
            body = _build_block_body(
                raw_path=self.path,
                raw_host=self.headers.get("Host", ""),
                user_agent=self.headers.get("User-Agent", ""),
                transport="http",
            )
            _send_block_headers(self, content_length=len(body))

        def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
            return

    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Block page server running: http://{host}:{port}", flush=True)
    server.serve_forever()
