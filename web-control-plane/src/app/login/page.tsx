"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BootstrapState = {
  bootstrapRequired: boolean;
  usersCount: number;
};

export default function LoginPage() {
  const router = useRouter();
  const [callbackUrl] = useState(() => {
    if (typeof window === "undefined") {
      return "/";
    }
    const next = new URLSearchParams(window.location.search).get("next");
    return next || "/";
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [adminName, setAdminName] = useState("Admin");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPassword2, setAdminPassword2] = useState("");

  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/bootstrap")
      .then((response) => response.json())
      .then((data: BootstrapState) => {
        if (mounted) {
          setBootstrap(data);
        }
      })
      .catch(() => {
        if (mounted) {
          setError("Cannot check bootstrap state.");
        }
      })
      .finally(() => {
        if (mounted) {
          setBootstrapLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });

    setLoading(false);

    if (!result || result.error) {
      setError("Invalid credentials or access denied.");
      return;
    }

    router.push(result.url || callbackUrl);
    router.refresh();
  }

  async function handleBootstrap(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        confirmPassword: adminPassword2,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      setLoading(false);
      setError(data.error || "Failed to create bootstrap admin.");
      return;
    }

    const loginResult = await signIn("credentials", {
      email: adminEmail,
      password: adminPassword,
      redirect: false,
      callbackUrl,
    });

    setLoading(false);

    if (!loginResult || loginResult.error) {
      setError("Admin created, but auto-login failed. Please sign in manually.");
      setBootstrap({ bootstrapRequired: false, usersCount: 1 });
      return;
    }

    router.push(loginResult.url || callbackUrl);
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-muted/20 p-4 md:p-8">
      <div className="mx-auto grid w-full max-w-5xl gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Badge variant="secondary" className="w-fit">VRKS Control Plane</Badge>
            <CardTitle className="mt-2 text-3xl">Sign in</CardTitle>
            <CardDescription>
              Authenticated access to runtime controls, policies, presets, and live system status.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleLogin}>
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loading || bootstrapLoading || Boolean(bootstrap?.bootstrapRequired)}
              >
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            <p className="mt-3 text-xs text-muted-foreground">
              Login is disabled until bootstrap admin is created (first launch only).
            </p>

            {error ? (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Authentication error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge variant="outline" className="w-fit">Bootstrap</Badge>
            <CardTitle className="mt-2 text-2xl">Initial admin</CardTitle>
            <CardDescription>Provision the first account with ADMIN permissions.</CardDescription>
          </CardHeader>
          <CardContent>
            {bootstrapLoading ? (
              <p className="text-sm text-muted-foreground">Checking bootstrap state...</p>
            ) : bootstrap?.bootstrapRequired ? (
              <>
                <p className="mb-4 text-sm text-muted-foreground">
                  No users found. Create the first <strong>ADMIN</strong> account.
                </p>
                <form className="space-y-4" onSubmit={handleBootstrap}>
                  <div className="space-y-2">
                    <Label htmlFor="admin-name">Name</Label>
                    <Input
                      id="admin-name"
                      value={adminName}
                      onChange={(event) => setAdminName(event.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="admin-email">Email</Label>
                    <Input
                      id="admin-email"
                      type="email"
                      value={adminEmail}
                      onChange={(event) => setAdminEmail(event.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="admin-password">Password</Label>
                    <Input
                      id="admin-password"
                      type="password"
                      value={adminPassword}
                      onChange={(event) => setAdminPassword(event.target.value)}
                      minLength={10}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="admin-password2">Confirm password</Label>
                    <Input
                      id="admin-password2"
                      type="password"
                      value={adminPassword2}
                      onChange={(event) => setAdminPassword2(event.target.value)}
                      minLength={10}
                      required
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Creating admin..." : "Create admin"}
                  </Button>
                </form>
              </>
            ) : (
              <Alert>
                <AlertTitle>Bootstrap completed</AlertTitle>
                <AlertDescription>
                  Users in system: <strong>{bootstrap?.usersCount ?? 0}</strong>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
