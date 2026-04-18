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
        description="VPN Resource Kill-Switch (generic resources with preset support).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    setup_p = sub.add_parser("setup", help="Install and initialize generic config.")
    setup_p.add_argument("--vpn-interface", help="VPN interface (auto-detected if omitted).")
    setup_p.add_argument("--name", help="Initial resource profile name (default: default).")
    setup_p.add_argument("--domain", action="append", help="Initial profile domains (repeat option).")
    setup_p.add_argument("--country", help="Required country for initial profile.")
    setup_p.add_argument("--server", help="Required server/IP/ISP pattern for initial profile.")
    setup_p.add_argument(
        "--allow-country",
        action="append",
        help="Allow only listed ISO country codes for initial profile (repeat option).",
    )
    setup_p.add_argument(
        "--block-country",
        action="append",
        help="Block listed ISO country codes for initial profile (repeat option).",
    )
    setup_p.add_argument(
        "--block-context",
        action="append",
        help="Block by VPN context keyword (country/region/city/org/isp/domain/ip), repeat option.",
    )
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

    bootstrap_p = sub.add_parser(
        "bootstrap",
        help="One-command start: setup(if needed) + preset apply + verify.",
    )
    bootstrap_p.add_argument("--preset", required=True, help="Preset name.")
    bootstrap_p.add_argument("--vpn-interface", help="VPN interface (auto-detected if omitted).")
    bootstrap_p.add_argument(
        "--no-install-bin",
        dest="install_bin",
        action="store_false",
        help="Do not install /usr/local/bin/vrks runtime on first setup.",
    )
    bootstrap_p.add_argument("--timeout", type=int, default=8, help="Verify probe timeout in seconds.")
    bootstrap_p.set_defaults(install_bin=True)

    apply_p = sub.add_parser("apply", help="Refresh nftables rules from current config.")

    status_p = sub.add_parser("status", help="Show config/runtime state.")
    status_p.add_argument("--json", action="store_true", help="Output raw JSON.")

    preset_list_p = sub.add_parser("preset-list", help="List built-in/user presets.")
    preset_list_p.add_argument("--json", action="store_true", help="Output JSON.")

    preset_apply_p = sub.add_parser("preset-apply", help="Apply preset to resource config.")
    preset_apply_p.add_argument("--name", required=True, help="Preset name.")
    preset_apply_p.add_argument("--replace", action="store_true", help="Replace if resource exists.")
    preset_apply_p.add_argument(
        "--no-apply",
        dest="run_apply",
        action="store_false",
        help="Only update config, do not run apply.",
    )
    preset_apply_p.set_defaults(run_apply=True)

    probe_p = sub.add_parser("probe", help="Run connectivity probe.")
    probe_p.add_argument("--resource", help="Resource name (default: first profile).")
    probe_p.add_argument("--domain", help="Specific domain to probe.")
    probe_p.add_argument("--non-vpn-interface", help="Override non-VPN interface for probe.")
    probe_p.add_argument("--timeout", type=int, default=8, help="Probe timeout in seconds.")

    access_p = sub.add_parser("access-check", help="Simple access verdict for resource.")
    access_p.add_argument("--resource", required=True, help="Resource name.")
    access_p.add_argument("--domain", help="Specific domain to check.")
    access_p.add_argument("--timeout", type=int, default=8, help="Probe timeout in seconds.")

    add_p = sub.add_parser("resource-add", help="Add or replace generic resource profile.")
    add_p.add_argument("--name", required=True, help="Resource profile name.")
    add_p.add_argument("--domain", action="append", required=True, help="Domain (repeat for many).")
    add_p.add_argument("--country", help="Required country for this resource.")
    add_p.add_argument("--server", help="Required server/IP/ISP match for this resource.")
    add_p.add_argument(
        "--allow-country",
        action="append",
        help="Allow only listed ISO country codes for this resource (repeat option).",
    )
    add_p.add_argument(
        "--block-country",
        action="append",
        help="Block listed ISO country codes for this resource (repeat option).",
    )
    add_p.add_argument(
        "--block-context",
        action="append",
        help="Block by VPN context keyword (country/region/city/org/isp/domain), repeat option.",
    )
    add_p.add_argument("--replace", action="store_true", help="Replace if profile exists.")

    rm_p = sub.add_parser("resource-remove", help="Remove resource profile.")
    rm_p.add_argument("--name", required=True)

    list_p = sub.add_parser("resource-list", help="List configured resources.")
    list_p.add_argument("--json", action="store_true", help="Output JSON.")

    verify_p = sub.add_parser("verify", help="Run full health verification (checks + probes).")
    verify_p.add_argument(
        "--resource",
        action="append",
        help="Verify only selected resource(s), repeat option. Default: all enabled resources.",
    )
    verify_p.add_argument("--timeout", type=int, default=8, help="Probe timeout in seconds.")

    watch_p = sub.add_parser("watch", help="Run realtime monitor and re-apply rules on link/route changes.")
    watch_p.add_argument(
        "--debounce",
        type=float,
        default=1.0,
        help="Minimum seconds between apply runs when many events arrive.",
    )

    disable_p = sub.add_parser("disable", help="Disable nft table now.")

    teardown_p = sub.add_parser("teardown", help="Remove systemd units and nft table.")
    teardown_p.add_argument("--purge", action="store_true", help="Also delete config/state.")
    teardown_p.add_argument("--remove-bin", action="store_true", help="Also remove /usr/local/bin/vrks.")

    gui_p = sub.add_parser("gui", help="Run local web GUI.")
    gui_p.add_argument("--host", default="127.0.0.1")
    gui_p.add_argument("--port", type=int, default=8877)

    api_p = sub.add_parser("api", help="Run REST API server with generated OpenAPI.")
    api_p.add_argument("--host", default="127.0.0.1")
    api_p.add_argument("--port", type=int, default=8787)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    svc = KillSwitchService()

    try:
        if args.command == "setup":
            result = svc.setup(
                vpn_interface=args.vpn_interface,
                resource_name=args.name,
                domains=args.domain,
                required_country=args.country,
                required_server=args.server,
                allowed_countries=args.allow_country,
                blocked_countries=args.block_country,
                blocked_context_keywords=args.block_context,
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

        if args.command == "bootstrap":
            result = svc.bootstrap(
                preset_name=args.preset,
                vpn_interface=args.vpn_interface,
                install_bin=args.install_bin,
                timeout=args.timeout,
            )
            verify = result["verify"]
            print(f"Preset: {result['preset']}")
            print(f"Bootstrap: {'PASS' if verify['passed'] else 'FAIL'}")
            if verify["issues"]:
                for issue in verify["issues"]:
                    print(f"Issue: {issue}")
            return 0 if verify["passed"] else 1

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
                                    "allowed_countries": r.policy.allowed_countries or [],
                                    "blocked_countries": r.policy.blocked_countries or [],
                                    "blocked_context_keywords": r.policy.blocked_context_keywords or [],
                                },
                            }
                            for r in status["config"].resources
                        ],
                    },
                    "vpn_up": status["vpn_up"],
                    "nft_table_present": status["nft_table_present"],
                    "timer_enabled": status["timer_enabled"],
                    "timer_active": status["timer_active"],
                    "watch_enabled": status["watch_enabled"],
                    "watch_active": status["watch_active"],
                    "state": status["state"],
                }
                print(json.dumps(printable, indent=2))
            else:
                print(f"VPN interface: {status['config'].vpn_interface}")
                print(f"VPN UP: {str(status['vpn_up']).lower()}")
                print(f"nft table: {str(status['nft_table_present']).lower()}")
                print(f"timer: {status['timer_enabled']} / {status['timer_active']}")
                print(f"watch: {status['watch_enabled']} / {status['watch_active']}")
                print("Resources:")
                for resource in status["config"].resources:
                    print(
                        f"  - {resource.name}: domains={len(resource.domains)} "
                        f"country={resource.policy.required_country or '-'} "
                        f"server={resource.policy.required_server or '-'} "
                        f"allow={','.join(resource.policy.allowed_countries or []) or '-'} "
                        f"block={','.join(resource.policy.blocked_countries or []) or '-'} "
                        f"ctxblock={','.join(resource.policy.blocked_context_keywords or []) or '-'}"
                    )
                if status["state"] and status["state"].get("updated_at"):
                    print(f"Last apply: {status['state']['updated_at']}")
            return 0

        if args.command == "preset-list":
            presets = svc.list_presets()
            if args.json:
                print(json.dumps(presets, indent=2))
            else:
                for preset in presets:
                    print(
                        f"{preset['name']}: {preset['description']} "
                        f"(domains={len(preset['domains'])})"
                    )
            return 0

        if args.command == "preset-apply":
            report = svc.apply_preset(name=args.name, replace=args.replace, run_apply=args.run_apply)
            print(f"Preset applied: {report['preset']['name']}")
            print(f"Run apply: {str(report['applied']).lower()}")
            if report["apply_report"] is not None:
                print(f"Counts: {report['apply_report']['counts']}")
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

        if args.command == "access-check":
            report = svc.access_check(
                resource_name=args.resource,
                domain=args.domain,
                timeout=args.timeout,
            )
            print(
                f"Access check resource={report['resource']} mode={report['expected_mode']} "
                f"vpn_reachable={str(report['vpn_reachable']).lower()} "
                f"non_vpn_blocked={str(report['non_vpn_blocked']).lower()} "
                f"result={'PASS' if report['access_ok'] else 'FAIL'}"
            )
            return 0 if report["access_ok"] else 1

        if args.command == "resource-add":
            cfg = svc.add_resource(
                name=args.name,
                domains=args.domain,
                required_country=args.country,
                required_server=args.server,
                allowed_countries=args.allow_country,
                blocked_countries=args.block_country,
                blocked_context_keywords=args.block_context,
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
                        f"server={policy['required_server'] or '-'}, "
                        f"allow={','.join(policy.get('allowed_countries') or []) or '-'}, "
                        f"block={','.join(policy.get('blocked_countries') or []) or '-'}, "
                        f"ctxblock={','.join(policy.get('blocked_context_keywords') or []) or '-'}]"
                    )
            return 0

        if args.command == "verify":
            report = svc.verify(resources=args.resource, timeout=args.timeout)
            print(f"Overall: {'PASS' if report['passed'] else 'FAIL'}")
            print(
                "Checks: "
                f"timer_enabled={report['checks']['timer_enabled']} "
                f"timer_active={report['checks']['timer_active']} "
                f"watch_enabled={report['checks']['watch_enabled']} "
                f"watch_active={report['checks']['watch_active']} "
                f"nft={str(report['checks']['nft_table_present']).lower()} "
                f"vpn_up={str(report['checks']['vpn_up']).lower()}"
            )
            for issue in report["issues"]:
                print(f"Issue: {issue}")
            for probe in report["probes"]:
                print(f"Probe resource={probe['resource']}: {'PASS' if probe['passed'] else 'FAIL'}")
            return 0 if report["passed"] else 1

        if args.command == "watch":
            return svc.watch(debounce_seconds=args.debounce)

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

        if args.command == "api":
            from .api import run_api_server

            run_api_server(host=args.host, port=args.port)
            return 0

        parser.print_help()
        return 1
    except CLIError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130
