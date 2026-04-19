"use client";

import { useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Copy, LogOut, Settings, ShieldCheck } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  name: string;
  email: string;
  role: string;
};

function toInitials(name: string, email: string): string {
  const base = (name || email || "U").trim();
  if (!base) {
    return "U";
  }

  const words = base
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (words.length >= 2) {
    return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
  }

  return base.slice(0, 2).toUpperCase();
}

function roleBadgeVariant(role: string): "default" | "secondary" | "outline" {
  if (role === "ADMIN") {
    return "default";
  }
  if (role === "OPERATOR") {
    return "secondary";
  }
  return "outline";
}

export function TopbarProfileMenu({ name, email, role }: Props) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const displayName = name?.trim() || email;
  const initials = useMemo(() => toInitials(name, email), [name, email]);

  async function copyEmail(): Promise<void> {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    await signOut({ callbackUrl: "/login" });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group flex h-10 max-w-[22rem] items-center gap-2 rounded-xl border border-border bg-background px-2 text-left transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
        <Avatar size="sm">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>

        <div className="hidden min-w-0 text-left sm:block">
          <p className="truncate text-sm font-semibold leading-none">{displayName}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{email}</p>
        </div>

        <Badge variant={roleBadgeVariant(role)} className="hidden md:inline-flex">
          {role}
        </Badge>
        <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5">
            <div className="flex items-center gap-2">
              <Avatar size="sm">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{displayName}</p>
                <p className="truncate text-xs text-muted-foreground">{email}</p>
              </div>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem disabled>
          <ShieldCheck className="size-4" />
          Role: {role}
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => void copyEmail()}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Email copied" : "Copy email"}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => router.push("/account")}>
          <Settings className="size-4" />
          Account settings
        </DropdownMenuItem>

        <DropdownMenuItem variant="destructive" onClick={() => void handleSignOut()} disabled={signingOut}>
          <LogOut className="size-4" />
          {signingOut ? "Signing out..." : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
