"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  role: string;
};

type NavItem = {
  href: string;
  label: string;
  minRole?: "ADMIN" | "OPERATOR";
};

const ITEMS: NavItem[] = [
  { href: "/overview", label: "Overview" },
  { href: "/profiles", label: "Profiles" },
  { href: "/presets", label: "Presets" },
  { href: "/imports", label: "Imports" },
  { href: "/repl", label: "REPL", minRole: "OPERATOR" },
  { href: "/users", label: "Users", minRole: "ADMIN" },
];

const ROLE_LEVEL: Record<string, number> = {
  VIEWER: 1,
  OPERATOR: 2,
  ADMIN: 3,
};

export function ConsoleNav({ role }: Props) {
  const pathname = usePathname();

  const visibleItems = ITEMS.filter((item) => {
    if (!item.minRole) {
      return true;
    }
    const currentLevel = ROLE_LEVEL[role] || 0;
    const requiredLevel = ROLE_LEVEL[item.minRole] || 0;
    return currentLevel >= requiredLevel;
  });

  return (
    <nav className="border-b border-slate-200 bg-slate-50">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-4 py-2 md:px-6">
        {visibleItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                active
                  ? "rounded-lg border border-cyan-700 bg-cyan-700 px-3 py-1.5 text-sm font-semibold text-white"
                  : "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              }
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
