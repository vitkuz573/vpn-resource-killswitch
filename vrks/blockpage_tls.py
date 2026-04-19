from __future__ import annotations

import ssl
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from .blockpage import _blocked_page_html, _resource_for_host, _sanitize_host, _state_for_resource
from .mitm_ca import issue_server_cert
from .network import normalize_domain


class _TlsBlockPageServer(ThreadingHTTPServer):
    def __init__(self, server_address: tuple[str, int], handler):
        super().__init__(server_address, handler)
        self._domain_contexts: dict[str, ssl.SSLContext] = {}
        self._ctx_lock = threading.Lock()

        default_cert, default_key = issue_server_cert("vrks-blocked.local")
        base_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        base_ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        base_ctx.load_cert_chain(certfile=str(default_cert), keyfile=str(default_key))
        base_ctx.set_servername_callback(self._sni_callback)
        self.socket = base_ctx.wrap_socket(self.socket, server_side=True)

    def _build_domain_context(self, domain: str) -> ssl.SSLContext:
        cert_path, key_path = issue_server_cert(domain)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))
        return ctx

    def _sni_callback(self, ssl_sock: ssl.SSLSocket, server_name: str | None, initial_ctx) -> None:
        _ = initial_ctx
        if not server_name:
            return
        try:
            domain = normalize_domain(server_name)
        except Exception:
            return

        with self._ctx_lock:
            ctx = self._domain_contexts.get(domain)
            if ctx is None:
                ctx = self._build_domain_context(domain)
                self._domain_contexts[domain] = ctx
        ssl_sock.context = ctx


def run_blockpage_tls_server(*, host: str, port: int) -> None:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            request_host = _sanitize_host(self.headers.get("Host", ""))
            resource_name = _resource_for_host(request_host)
            mode, reason = _state_for_resource(resource_name)
            body = _blocked_page_html(
                host=request_host,
                path=parsed.path or "/",
                resource=resource_name,
                mode=mode,
                reason=reason,
                transport="https",
            ).encode("utf-8")
            self.send_response(451)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_HEAD(self) -> None:  # noqa: N802
            self.send_response(451)
            self.end_headers()

        def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
            return

    server = _TlsBlockPageServer((host, port), Handler)
    print(f"TLS block page server running: https://{host}:{port}", flush=True)
    server.serve_forever()
