from __future__ import annotations

import ipaddress

from .constants import BLOCK_PAGE_PORT, NFT_NAT_TABLE, NFT_TABLE, TLS_BLOCK_PAGE_PORT
from .network import validate_ifname
from .system import run


def nft_table_exists() -> bool:
    proc = run(["nft", "list", "table", "inet", NFT_TABLE], check=False)
    return proc.returncode == 0


def nft_nat_table_exists() -> bool:
    proc = run(["nft", "list", "table", "ip", NFT_NAT_TABLE], check=False)
    return proc.returncode == 0


def _render_set(name: str, addr_type: str, values: list[str]) -> str:
    lines = [
        f"  set {name} {{",
        f"    type {addr_type}",
        "    flags interval",
    ]
    if values:
        lines.append(f"    elements = {{ {', '.join(values)} }}")
    lines.append("  }")
    return "\n".join(lines)


def build_nft_rules(
    vpn_interface: str,
    vpn_only_v4: set[str],
    vpn_only_v6: set[str],
    hard_block_v4: set[str],
    hard_block_v6: set[str],
    block_page_port: int | None = BLOCK_PAGE_PORT,
    tls_block_page_port: int | None = TLS_BLOCK_PAGE_PORT,
) -> str:
    validate_ifname(vpn_interface)
    v4_vpn_sorted = sorted(vpn_only_v4, key=lambda x: ipaddress.ip_address(x))
    v6_vpn_sorted = sorted(vpn_only_v6, key=lambda x: ipaddress.ip_address(x))
    v4_block_sorted = sorted(hard_block_v4, key=lambda x: ipaddress.ip_address(x))
    v6_block_sorted = sorted(hard_block_v6, key=lambda x: ipaddress.ip_address(x))

    nat_lines: list[str] = []
    if block_page_port is not None and block_page_port > 0:
        nat_lines.append(f"ip daddr @hard_block_v4 tcp dport 80 redirect to :{block_page_port}")
        nat_lines.append(
            f'ip daddr @vpn_only_v4 oifname != "{vpn_interface}" tcp dport 80 redirect to :{block_page_port}'
        )
    if tls_block_page_port is not None and tls_block_page_port > 0:
        nat_lines.append(f"ip daddr @hard_block_v4 tcp dport 443 redirect to :{tls_block_page_port}")
        nat_lines.append(
            f'ip daddr @vpn_only_v4 oifname != "{vpn_interface}" tcp dport 443 redirect to :{tls_block_page_port}'
        )

    filter_table = (
        f"table inet {NFT_TABLE} {{\n"
        + _render_set("vpn_only_v4", "ipv4_addr", v4_vpn_sorted)
        + "\n\n"
        + _render_set("vpn_only_v6", "ipv6_addr", v6_vpn_sorted)
        + "\n\n"
        + _render_set("hard_block_v4", "ipv4_addr", v4_block_sorted)
        + "\n\n"
        + _render_set("hard_block_v6", "ipv6_addr", v6_block_sorted)
        + "\n\n"
        + "  chain output {\n"
        + "    type filter hook output priority filter; policy accept;\n"
        + "    ip daddr @hard_block_v4 reject with icmpx type admin-prohibited\n"
        + "    ip6 daddr @hard_block_v6 reject with icmpx type admin-prohibited\n"
        + f'    ip daddr @vpn_only_v4 oifname != "{vpn_interface}" reject with icmpx type admin-prohibited\n'
        + f'    ip6 daddr @vpn_only_v6 oifname != "{vpn_interface}" reject with icmpx type admin-prohibited\n'
        + "  }\n"
        + "}\n"
    )

    nat_table = ""
    if nat_lines:
        nat_table = (
            f"\ntable ip {NFT_NAT_TABLE} {{\n"
            + _render_set("vpn_only_v4", "ipv4_addr", v4_vpn_sorted)
            + "\n\n"
            + _render_set("hard_block_v4", "ipv4_addr", v4_block_sorted)
            + "\n\n"
            + "  chain output {\n"
            + "    type nat hook output priority dstnat; policy accept;\n"
            + "".join(f"    {line}\n" for line in nat_lines)
            + "  }\n"
            + "}\n"
        )

    return filter_table + nat_table


def apply_nft(
    vpn_interface: str,
    vpn_only_v4: set[str],
    vpn_only_v6: set[str],
    hard_block_v4: set[str],
    hard_block_v6: set[str],
    block_page_port: int | None = BLOCK_PAGE_PORT,
    tls_block_page_port: int | None = TLS_BLOCK_PAGE_PORT,
) -> None:
    script = ""
    if nft_table_exists():
        script += f"delete table inet {NFT_TABLE}\n"
    if nft_nat_table_exists():
        script += f"delete table ip {NFT_NAT_TABLE}\n"
    script += build_nft_rules(
        vpn_interface=vpn_interface,
        vpn_only_v4=vpn_only_v4,
        vpn_only_v6=vpn_only_v6,
        hard_block_v4=hard_block_v4,
        hard_block_v6=hard_block_v6,
        block_page_port=block_page_port,
        tls_block_page_port=tls_block_page_port,
    )
    run(["nft", "-f", "-"], input_data=script, check=True)


def delete_nft_table() -> None:
    if nft_table_exists():
        run(["nft", "delete", "table", "inet", NFT_TABLE], check=True)
    if nft_nat_table_exists():
        run(["nft", "delete", "table", "ip", NFT_NAT_TABLE], check=True)
