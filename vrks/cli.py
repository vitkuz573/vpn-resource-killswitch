from __future__ import annotations

import argparse
import json
import sys

from .errors import CLIError
from .gui import launch_gui
from .service import KillSwitchService


def _print_probe(report: dict) -> None:
    print(f"Resource: {report['resource']}")
    print(f"Target: {report['url']}")
    print(f"Expected mode: {report['expected_mode']}")

    vpn = report["vpn_result"]
    print(
        f"VPN ({vpn['interface']}): rc={vpn['returncode']} "
        f"http={vpn['http_code']} reachable={str(vpn['reachable']).lower()}"
    )
    if vpn.get("stderr"):
        print(f"  stderr: {vpn['stderr']}")

    plain = report["non_vpn_result"]
    print(
        f"Non-VPN ({plain['interface']}): rc={plain['returncode']} "
        f"http={plain['http_code']} blocked={str(plain['blocked']).lower()}"
    )
    if plain.get("stderr"):
        print(f"  stderr: {plain['stderr']}")

    print("Result: PASS" if report["passed"] else "Result: FAIL")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vrks",
        description="VPN Resource Kill-Switch (generic resources, default antigravity profile).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    setup_p = sub.add_parser("setup", help="Install and initialize config with antigravity profile.")
    setup_p.add_argument("--vpn-interface", help="VPN interface (auto-detected if omitted).")
    setup_p.add_argument("--domain", action="append", help="Antigravity domains for initial profile.")
    setup_p.add_argument("--country", help="Required country for antigravity profile.")
    setup_p.add_argument("--server", help="Required server/IP/ISP pattern for antigravity profile.")
    setup_p.add_argument(
        "--no-install-bin",
        dest="install_bin",
        action="store_false",
        help="Do not install /usr/local/bin/vrks runtime.",
    )
    setup_p.add_argument(
        "--no-self-test",
        dest="self_test",
        action="store_false",
        help="Skip probe test after setup.",
    )
    setup_p.add_argument("--timeout", type=int, default=8, help="Probe timeout in seconds.")
    setup_p.set_defaults(install_bin=True, self_test=True)

    apply_p = sub.add_parser("apply", help="Refresh nftables rules from current config.")

    status_p = sub.add_parser("status", help="Show config/runtime state.")
    status_p.add_argument("--json", action="store_true", help="Output raw JSON.")

    probe_p = sub.add_parser("probe", help="Run connectivity probe.")
    probe_p.add_argument("--resource", help="Resource name (default: first profile).")
    probe_p.add_argument("--domain", help="Specific domain to probe.")
    probe_p.add_argument("--non-vpn-interface", help="Override non-VPN interface for probe.")
    probe_p.add_argument("--timeout", type=int, default=8, help="Probe timeout in seconds.")

    add_p = sub.add_parser("resource-add", help="Add or replace generic resource profile.")
    add_p.add_argument("--name", required=True, help="Resource profile name.")
    add_p.add_argument("--domain", action="append", required=True, help="Domain (repeat for many).")
    add_p.add_argument("--country", help="Required country for this resource.")
    add_p.add_argument("--server", help="Required server/IP/ISP match for this resource.")
    add_p.add_argument("--replace", action="store_true", help="Replace if profile exists.")

    rm_p = sub.add_parser("resource-remove", help="Remove resource profile.")
    rm_p.add_argument("--name", required=True)

    list_p = sub.add_parser("resource-list", help="List configured resources.")
    list_p.add_argument("--json", action="store_true", help="Output JSON.")

    disable_p = sub.add_parser("disable", help="Disable nft table now.")

    teardown_p = sub.add_parser("teardown", help="Remove systemd units and nft table.")
    teardown_p.add_argument("--purge", action="store_true", help="Also delete config/state.")
    teardown_p.add_argument("--remove-bin", action="store_true", help="Also remove /usr/local/bin/vrks.")

    gui_p = sub.add_parser("gui", help="Run local web GUI.")
    gui_p.add_argument("--host", default="127.0.0.1")
    gui_p.add_argument("--port", type=int, default=8877)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    svc = KillSwitchService()

    try:
        if args.command == "setup":
            result = svc.setup(
                vpn_interface=args.vpn_interface,
                domains=args.domain,
                required_country=args.country,
                required_server=args.server,
                install_bin=args.install_bin,
            )
            cfg = result["config"]
            report = result["report"]
            print(f"VPN interface: {cfg.vpn_interface}")
            print(f"Initial profile: {cfg.resources[0].name} ({', '.join(cfg.resources[0].domains)})")
            print(f"Rules count: {report['counts']}")
            if report["failures"]:
                print("Warnings:")
                for failure in report["failures"]:
                    print(f"  - {failure}")
            if args.self_test:
                probe = svc.probe(
                    resource_name=None,
                    domain=None,
                    non_vpn_interface=None,
                    timeout=args.timeout,
                )
                _print_probe(probe)
                if not probe["passed"]:
                    return 1
            return 0

        if args.command == "apply":
            report = svc.apply()
            print("Rules refreshed.")
            print(f"Counts: {report['counts']}")
            if report["failures"]:
                print("Warnings:")
                for failure in report["failures"]:
                    print(f"  - {failure}")
            return 0

        if args.command == "status":
            status = svc.status()
            if args.json:
                printable = {
                    "config": {
                        "version": status["config"].version,
                        "vpn_interface": status["config"].vpn_interface,
                        "resources": [
                            {
                                "name": r.name,
                                "domains": r.domains,
                                "enabled": r.enabled,
                                "policy": {
                                    "required_country": r.policy.required_country,
                                    "required_server": r.policy.required_server,
                                },
                            }
                            for r in status["config"].resources
                        ],
                    },
                    "vpn_up": status["vpn_up"],
                    "nft_table_present": status["nft_table_present"],
                    "timer_enabled": status["timer_enabled"],
                    "timer_active": status["timer_active"],
                    "state": status["state"],
                }
                print(json.dumps(printable, indent=2))
            else:
                print(f"VPN interface: {status['config'].vpn_interface}")
                print(f"VPN UP: {str(status['vpn_up']).lower()}")
                print(f"nft table: {str(status['nft_table_present']).lower()}")
                print(f"timer: {status['timer_enabled']} / {status['timer_active']}")
                print("Resources:")
                for resource in status["config"].resources:
                    print(
                        f"  - {resource.name}: domains={len(resource.domains)} "
                        f"country={resource.policy.required_country or '-'} "
                        f"server={resource.policy.required_server or '-'}"
                    )
                if status["state"] and status["state"].get("updated_at"):
                    print(f"Last apply: {status['state']['updated_at']}")
            return 0

        if args.command == "probe":
            report = svc.probe(
                resource_name=args.resource,
                domain=args.domain,
                non_vpn_interface=args.non_vpn_interface,
                timeout=args.timeout,
            )
            _print_probe(report)
            return 0 if report["passed"] else 1

        if args.command == "resource-add":
            cfg = svc.add_resource(
                name=args.name,
                domains=args.domain,
                required_country=args.country,
                required_server=args.server,
                replace=args.replace,
            )
            print(f"Resource saved. Total resources: {len(cfg.resources)}")
            return 0

        if args.command == "resource-remove":
            cfg = svc.remove_resource(args.name)
            print(f"Resource removed. Total resources: {len(cfg.resources)}")
            return 0

        if args.command == "resource-list":
            resources = svc.list_resources()
            if args.json:
                print(json.dumps(resources, indent=2))
            else:
                for resource in resources:
                    policy = resource["policy"]
                    print(
                        f"{resource['name']}: {', '.join(resource['domains'])} "
                        f"[country={policy['required_country'] or '-'}, "
                        f"server={policy['required_server'] or '-'}]"
                    )
            return 0

        if args.command == "disable":
            svc.disable()
            print("nft table removed.")
            return 0

        if args.command == "teardown":
            svc.teardown(purge=args.purge, remove_bin=args.remove_bin)
            print("Teardown completed.")
            return 0

        if args.command == "gui":
            launch_gui(svc, host=args.host, port=args.port)
            return 0

        parser.print_help()
        return 1
    except CLIError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130

