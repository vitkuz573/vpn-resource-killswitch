from __future__ import annotations

import posixpath
import re
import socket
import ssl
import urllib.parse
import urllib.request
from collections import deque
from dataclasses import dataclass
from html.parser import HTMLParser

from .network import normalize_domain, normalize_domains


ABS_URL_RE = re.compile(r"(?i)https?://[^\s\"'<>\\)]+")
CSS_URL_RE = re.compile(r"(?i)url\\(([^)]+)\\)")
JS_STR_RE = re.compile(r"(?i)(?:'|\")((?:https?:)?//[^'\"\\s<>]+)(?:'|\")")

CRAWLABLE_EXTENSIONS = {
    "",
    ".asp",
    ".aspx",
    ".cfm",
    ".cgi",
    ".css",
    ".htm",
    ".html",
    ".js",
    ".json",
    ".jsp",
    ".jspx",
    ".mjs",
    ".php",
    ".pl",
    ".svg",
    ".txt",
    ".webmanifest",
    ".xhtml",
    ".xml",
}
NON_CRAWLABLE_EXTENSIONS = {
    ".7z",
    ".avi",
    ".bmp",
    ".doc",
    ".docx",
    ".eot",
    ".gif",
    ".gz",
    ".ico",
    ".jpeg",
    ".jpg",
    ".m4a",
    ".mov",
    ".mp3",
    ".mp4",
    ".otf",
    ".pdf",
    ".png",
    ".rar",
    ".tar",
    ".tgz",
    ".ttf",
    ".wav",
    ".webm",
    ".webp",
    ".woff",
    ".woff2",
    ".xls",
    ".xlsx",
    ".zip",
}
TEXTUAL_CONTENT_TYPES = {
    "application/atom+xml",
    "application/javascript",
    "application/json",
    "application/ld+json",
    "application/rss+xml",
    "application/x-javascript",
    "application/xhtml+xml",
    "application/xml",
    "image/svg+xml",
}


class _AttrLinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: set[str] = set()

    def handle_starttag(self, tag: str, attrs) -> None:  # type: ignore[override]
        _ = tag
        for key, value in attrs:
            if not value:
                continue
            if key.lower() in {"src", "href", "action", "data-src", "poster"}:
                self.links.add(str(value))


@dataclass
class DiscoverResult:
    seeds: list[str]
    crawled_urls: list[str]
    domains: list[str]
    external_domains: list[str]
    unresolved_domains: list[str]
    failures: list[str]


def _base_domain(host: str) -> str:
    labels = host.split(".")
    if len(labels) <= 2:
        return host
    # Basic ccTLD support without external deps.
    if (
        len(labels[-1]) == 2
        and labels[-2] in {"co", "com", "net", "org", "gov", "edu", "ac"}
        and len(labels) >= 3
    ):
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def _is_same_site(host: str, allowed_bases: set[str]) -> bool:
    return _base_domain(host) in allowed_bases


def _extract_links_from_text(text: str) -> set[str]:
    links: set[str] = set()
    parser = _AttrLinkParser()
    try:
        parser.feed(text)
        links |= parser.links
    except Exception:
        pass

    for regex in (ABS_URL_RE, CSS_URL_RE, JS_STR_RE):
        for match in regex.finditer(text):
            value = match.group(1) if match.groups() else match.group(0)
            if value:
                links.add(value.strip())
    return links


def _normalize_url(raw: str, base_url: str) -> str | None:
    value = raw.strip().strip("\"' ")
    if not value or value.startswith(("data:", "javascript:", "mailto:", "tel:")):
        return None
    value = value.replace("&amp;", "&")

    if value.startswith("//"):
        base = urllib.parse.urlsplit(base_url)
        value = f"{base.scheme}:{value}"
    elif value.startswith("/"):
        value = urllib.parse.urljoin(base_url, value)
    elif not value.startswith(("http://", "https://")):
        value = urllib.parse.urljoin(base_url, value)

    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"}:
        return None
    if not parsed.hostname:
        return None

    try:
        host = normalize_domain(parsed.hostname)
    except Exception:
        return None

    try:
        port = parsed.port
    except ValueError:
        return None
    if port is not None:
        default_port = 80 if parsed.scheme == "http" else 443
        netloc = f"{host}:{port}" if port != default_port else host
    else:
        netloc = host

    path = parsed.path or "/"
    try:
        path = urllib.parse.quote(urllib.parse.unquote(path), safe="/:@-._~!$&'()*+,;=")
        query = urllib.parse.quote(
            urllib.parse.unquote(parsed.query),
            safe="=&:@-._~!$'()*+,;/",
        )
    except Exception:
        return None

    return urllib.parse.urlunsplit((parsed.scheme.lower(), netloc, path, query, ""))


def _is_textual_content_type(content_type: str) -> bool:
    value = (content_type or "").split(";", 1)[0].strip().lower()
    if not value:
        return True
    if value.startswith("text/"):
        return True
    return value in TEXTUAL_CONTENT_TYPES


def _is_crawlable_url(url: str) -> bool:
    parsed = urllib.parse.urlsplit(url)
    extension = posixpath.splitext(parsed.path.lower())[1]
    if extension in NON_CRAWLABLE_EXTENSIONS:
        return False
    return extension in CRAWLABLE_EXTENSIONS


def discover_domains(
    *,
    seed_domains: list[str],
    max_depth: int = 2,
    timeout: int = 10,
    max_pages: int = 120,
    max_bytes: int = 1_000_000,
    include_external: bool = False,
    dns_check: bool = True,
) -> DiscoverResult:
    seeds = normalize_domains(seed_domains)
    seed_urls = [f"https://{domain}/" for domain in seeds]
    allowed_bases = {_base_domain(domain) for domain in seeds}

    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    queue: deque[tuple[str, int]] = deque((url, 0) for url in seed_urls)
    queued: set[str] = set(seed_urls)
    visited: set[str] = set()
    crawled_urls: list[str] = []
    failures: list[str] = []

    domains: set[str] = set(seeds)
    external_domains: set[str] = set()

    while queue and len(visited) < max_pages:
        url, depth = queue.popleft()
        if url in visited:
            continue
        visited.add(url)
        crawled_urls.append(url)

        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "vrks-discovery/1.0",
                    "Accept": "text/html,text/plain,application/json,application/xml,*/*",
                },
            )
            with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
                final_url = resp.geturl()
                content_type = resp.headers.get("Content-Type", "")
                payload = resp.read(max_bytes + 1)
        except Exception as exc:
            failures.append(f"{url}: {exc}")
            continue

        if len(payload) > max_bytes:
            failures.append(f"{url}: response_truncated(max_bytes={max_bytes})")
            payload = payload[:max_bytes]

        parsed_final = urllib.parse.urlsplit(final_url)
        if parsed_final.hostname:
            try:
                host = normalize_domain(parsed_final.hostname)
                if _is_same_site(host, allowed_bases):
                    domains.add(host)
                else:
                    external_domains.add(host)
            except Exception:
                pass

        if not _is_textual_content_type(content_type):
            continue

        text = payload.decode("utf-8", "ignore")
        links = _extract_links_from_text(text)

        for candidate in sorted(links):
            normalized = _normalize_url(candidate, final_url)
            if not normalized:
                continue
            parsed = urllib.parse.urlsplit(normalized)
            if not parsed.hostname:
                continue
            try:
                host = normalize_domain(parsed.hostname)
            except Exception:
                continue

            same_site = _is_same_site(host, allowed_bases)
            if same_site:
                domains.add(host)
            else:
                external_domains.add(host)

            can_crawl = depth < max_depth and (same_site or include_external) and _is_crawlable_url(
                normalized
            )
            if can_crawl and normalized not in visited and normalized not in queued:
                queued.add(normalized)
                queue.append((normalized, depth + 1))

    if include_external:
        domains |= external_domains

    unresolved_domains: list[str] = []
    if dns_check:
        resolved: set[str] = set()
        for domain in sorted(domains):
            try:
                socket.getaddrinfo(domain, 443, type=socket.SOCK_STREAM)
                resolved.add(domain)
            except Exception:
                unresolved_domains.append(domain)
        domains = resolved

    return DiscoverResult(
        seeds=seeds,
        crawled_urls=sorted(crawled_urls),
        domains=sorted(domains),
        external_domains=sorted(external_domains),
        unresolved_domains=sorted(unresolved_domains),
        failures=failures,
    )
