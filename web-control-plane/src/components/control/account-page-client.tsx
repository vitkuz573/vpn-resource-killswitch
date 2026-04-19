"use client";

import { useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  apiGetAccount,
  apiGetAccountSessions,
  apiPatchAccount,
  apiPostAccountPassword,
  apiPostAccountSessions,
} from "@/lib/api/client";
import { formatDate } from "@/lib/control-plane-client";

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

type ActiveSession = {
  sessionId: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
};

type LoginEvent = {
  id: string;
  method: string;
  success: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  sessionId: string | null;
  createdAt: string;
};

export function AccountPageClient({ userRole }: Props) {
  const [loading, setLoading] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [recentLogins, setRecentLogins] = useState<LoginEvent[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [output, setOutput] = useState("(idle)");

  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [profileCurrentPassword, setProfileCurrentPassword] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const busy = loading || passwordBusy || sessionsBusy || signingOut;

  const emailChanged = useMemo(() => {
    if (!profile) {
      return false;
    }
    return emailInput.trim().toLowerCase() !== profile.email.toLowerCase();
  }, [profile, emailInput]);

  async function refreshProfile(): Promise<void> {
    const data = await apiGetAccount();
    setProfile(data.profile);
    setNameInput(data.profile.name);
    setEmailInput(data.profile.email);
  }

  async function refreshSessionSecurity(): Promise<void> {
    const data = await apiGetAccountSessions();
    setCurrentSessionId(data.currentSessionId);
    setActiveSessions(data.activeSessions || []);
    setRecentLogins(data.recentLogins || []);
  }

  async function refreshAll(): Promise<void> {
    setLoading(true);
    try {
      await Promise.all([refreshProfile(), refreshSessionSecurity()]);
      setOutput("Account state refreshed.");
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Failed to refresh account state");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshAll();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const data = await apiPatchAccount({
          name: normalizedName,
          email: normalizedEmail,
          currentPassword: profileCurrentPassword || undefined,
      });

      setProfile(data.profile);
      setNameInput(data.profile.name);
      setEmailInput(data.profile.email);
      setProfileCurrentPassword("");
      await refreshSessionSecurity();

      if (data.requiresReauth) {
        setOutput("Profile updated. Session re-authentication required.");
        setSigningOut(true);
        await signOut({ callbackUrl: "/login" });
        return;
      }

      setOutput("Profile updated.");
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
      const data = await apiPostAccountPassword({
        currentPassword,
        newPassword,
        confirmPassword,
      });

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      if (data.requiresReauth) {
        setOutput(`${data.message} Re-authentication required.`);
        setSigningOut(true);
        await signOut({ callbackUrl: "/login" });
        return;
      }

      setOutput(data.message);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Password update failed");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function updateSessions(action: "revoke" | "revoke_others" | "revoke_all", sessionId?: string): Promise<void> {
    if (action === "revoke" && !sessionId) {
      setOutput("Session id is required for single-session revoke.");
      return;
    }

    setSessionsBusy(true);
    try {
      const data =
        action === "revoke"
          ? await apiPostAccountSessions({
              action: "revoke",
              sessionId: sessionId as string,
            })
          : await apiPostAccountSessions({
              action,
            });

      if (data.requiresReauth) {
        setOutput(`Session action '${data.action}' revoked ${data.revokedCount} sessions. Re-authentication required.`);
        setSigningOut(true);
        await signOut({ callbackUrl: "/login" });
        return;
      }

      await refreshSessionSecurity();
      setOutput(`Session action '${data.action}' revoked ${data.revokedCount} sessions.`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Session update failed");
    } finally {
      setSessionsBusy(false);
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
            <CardDescription>Manage profile identity, password, and active sessions.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void refreshAll()} disabled={busy}>
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

      <Card className="col-span-12">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Active sessions</CardTitle>
            <CardDescription>Review and revoke active authenticated sessions.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void updateSessions("revoke_others")}
              disabled={busy}
            >
              Revoke others
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void updateSessions("revoke_all")}
              disabled={busy}
            >
              Revoke all
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {activeSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active sessions found.</p>
            ) : (
              activeSessions.map((session) => {
                const isCurrent = currentSessionId === session.sessionId;
                return (
                  <div
                    key={session.sessionId}
                    className="flex flex-col gap-2 rounded-lg border bg-muted/20 px-3 py-2 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{session.sessionId.slice(0, 12)}...</span>
                        {isCurrent ? <Badge variant="secondary">current</Badge> : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {session.userAgent || "Unknown user-agent"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        IP {session.ipAddress || "-"} · seen {formatDate(session.lastSeenAt)} · created {formatDate(session.createdAt)}
                      </p>
                    </div>
                    <div>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => void updateSessions("revoke", session.sessionId)}
                        disabled={busy}
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="col-span-12">
        <CardHeader>
          <CardTitle>Login history</CardTitle>
          <CardDescription>Recent successful login events for this account.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {recentLogins.length === 0 ? (
              <p className="text-sm text-muted-foreground">No login events found.</p>
            ) : (
              recentLogins.map((event) => (
                <div
                  key={event.id}
                  className="flex flex-col gap-1 rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={event.success ? "default" : "outline"}>{event.success ? "success" : "failed"}</Badge>
                    <span className="font-medium text-foreground">{event.method}</span>
                    <span>{formatDate(event.createdAt)}</span>
                  </div>
                  <p className="truncate">{event.userAgent || "Unknown user-agent"}</p>
                  <p>IP {event.ipAddress || "-"} · session {event.sessionId ? `${event.sessionId.slice(0, 12)}...` : "-"}</p>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="col-span-12">
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
