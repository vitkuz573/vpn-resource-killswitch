"use client";

import { useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, parseResponse } from "@/lib/control-plane-client";

type Props = {
  userRole: string;
};

type AccountProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function AccountPageClient({ userRole }: Props) {
  const [loading, setLoading] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [output, setOutput] = useState("(idle)");

  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [profileCurrentPassword, setProfileCurrentPassword] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const busy = loading || passwordBusy || signingOut;

  const emailChanged = useMemo(() => {
    if (!profile) {
      return false;
    }
    return emailInput.trim().toLowerCase() !== profile.email.toLowerCase();
  }, [profile, emailInput]);

  async function refreshProfile(): Promise<void> {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/account", { cache: "no-store" });
      const data = await parseResponse<{ profile: AccountProfile }>(response);
      setProfile(data.profile);
      setNameInput(data.profile.name);
      setEmailInput(data.profile.email);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Failed to load account profile");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshProfile();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  async function saveProfile(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!profile) {
      return;
    }

    const normalizedName = nameInput.trim();
    const normalizedEmail = emailInput.trim().toLowerCase();
    const noChanges = normalizedName === profile.name && normalizedEmail === profile.email.toLowerCase();
    if (noChanges) {
      setOutput("No profile changes detected.");
      return;
    }
    if (emailChanged && !profileCurrentPassword) {
      setOutput("Current password is required to change email.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normalizedName,
          email: normalizedEmail,
          currentPassword: profileCurrentPassword || undefined,
        }),
      });
      const data = await parseResponse<{
        ok: boolean;
        profile: AccountProfile;
        requiresReauth: boolean;
      }>(response);

      setProfile(data.profile);
      setNameInput(data.profile.name);
      setEmailInput(data.profile.email);
      setProfileCurrentPassword("");

      if (data.requiresReauth) {
        setOutput("Profile updated. Email changed, please sign out and sign in again.");
      } else {
        setOutput("Profile updated.");
      }
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Profile update failed");
    } finally {
      setLoading(false);
    }
  }

  async function changePassword(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPasswordBusy(true);
    try {
      const response = await fetch("/api/auth/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const data = await parseResponse<{ ok: boolean; requiresReauth: boolean; message: string }>(response);

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setOutput(`${data.message} Sign out and sign in again to refresh all sessions.`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Password update failed");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function runSignOut(): Promise<void> {
    setSigningOut(true);
    await signOut({ callbackUrl: "/login" });
  }

  return (
    <main className="grid grid-cols-12 gap-4">
      <Card className="col-span-12">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-2xl">Account settings</CardTitle>
            <CardDescription>Manage profile identity and authentication security.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void refreshProfile()} disabled={busy}>
              Refresh
            </Button>
            <Button type="button" variant="destructive" onClick={() => void runSignOut()} disabled={busy}>
              {signingOut ? "Signing out..." : "Sign out"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card className="col-span-12 md:col-span-5">
        <CardHeader>
          <CardTitle>Account overview</CardTitle>
          <CardDescription>Readonly identity and access metadata.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
            <span className="text-sm text-muted-foreground">Role</span>
            <Badge variant="secondary">{profile?.role || userRole}</Badge>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
            <span className="text-sm text-muted-foreground">Status</span>
            <Badge variant={profile?.isActive === false ? "outline" : "default"}>
              {profile?.isActive === false ? "disabled" : "active"}
            </Badge>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
            <span className="text-sm text-muted-foreground">Last login</span>
            <span className="text-xs font-mono">{formatDate(profile?.lastLoginAt)}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
            <span className="text-sm text-muted-foreground">Created</span>
            <span className="text-xs font-mono">{formatDate(profile?.createdAt)}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
            <span className="text-sm text-muted-foreground">Updated</span>
            <span className="text-xs font-mono">{formatDate(profile?.updatedAt)}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
            <span className="text-sm text-muted-foreground">Account id</span>
            <span className="max-w-44 truncate text-xs font-mono">{profile?.id || "-"}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="col-span-12 md:col-span-7">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Update display name and login email.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={saveProfile}>
            <div className="space-y-2">
              <Label htmlFor="account-name">Display name</Label>
              <Input
                id="account-name"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                minLength={2}
                maxLength={80}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-email">Email</Label>
              <Input
                id="account-email"
                type="email"
                value={emailInput}
                onChange={(event) => setEmailInput(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-current-password">
                Current password {emailChanged ? "(required for email change)" : "(optional)"}
              </Label>
              <Input
                id="account-current-password"
                type="password"
                value={profileCurrentPassword}
                onChange={(event) => setProfileCurrentPassword(event.target.value)}
                placeholder={emailChanged ? "Enter current password" : "Only required for email change"}
              />
            </div>

            <Button type="submit" disabled={busy}>
              Save profile
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="col-span-12 md:col-span-7">
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Change account password with current-password verification.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={changePassword}>
            <div className="space-y-2">
              <Label htmlFor="pwd-current">Current password</Label>
              <Input
                id="pwd-current"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pwd-next">New password</Label>
              <Input
                id="pwd-next"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={10}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pwd-confirm">Confirm new password</Label>
              <Input
                id="pwd-confirm"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={10}
                required
              />
            </div>
            <Button type="submit" variant="secondary" disabled={busy}>
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="col-span-12 md:col-span-5">
        <CardHeader>
          <CardTitle>Output</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs">{output}</pre>
        </CardContent>
      </Card>
    </main>
  );
}
