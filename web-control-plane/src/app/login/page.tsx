"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

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
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900 md:p-8">
      <div className="mx-auto grid w-full max-w-5xl gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">VRKS Control Plane</p>
          <h1 className="mt-2 text-3xl font-bold">Sign in</h1>
          <p className="mt-2 text-sm text-slate-600">
            Authenticated access to VRKS operations, policies, presets, and live status.
          </p>

          <form className="mt-6 space-y-3" onSubmit={handleLogin}>
            <label className="block text-sm font-medium text-slate-700">
              Email
              <input
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none ring-cyan-500 focus:ring-2"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Password
              <input
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none ring-cyan-500 focus:ring-2"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            <button
              type="submit"
              disabled={loading || bootstrapLoading || Boolean(bootstrap?.bootstrapRequired)}
              className="w-full rounded-xl bg-cyan-700 px-4 py-2 font-semibold text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="mt-3 text-xs text-slate-500">
            Login is disabled until bootstrap admin is created (first launch only).
          </p>

          {error ? <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Bootstrap</p>
          <h2 className="mt-2 text-2xl font-bold">Initial admin</h2>

          {bootstrapLoading ? (
            <p className="mt-4 text-sm text-slate-600">Checking bootstrap state...</p>
          ) : bootstrap?.bootstrapRequired ? (
            <>
              <p className="mt-2 text-sm text-slate-600">
                No users found. Create the first <strong>ADMIN</strong> account.
              </p>
              <form className="mt-5 space-y-3" onSubmit={handleBootstrap}>
                <label className="block text-sm font-medium text-slate-700">
                  Name
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none ring-amber-500 focus:ring-2"
                    value={adminName}
                    onChange={(event) => setAdminName(event.target.value)}
                    required
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Email
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none ring-amber-500 focus:ring-2"
                    type="email"
                    value={adminEmail}
                    onChange={(event) => setAdminEmail(event.target.value)}
                    required
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Password
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none ring-amber-500 focus:ring-2"
                    type="password"
                    value={adminPassword}
                    onChange={(event) => setAdminPassword(event.target.value)}
                    minLength={10}
                    required
                  />
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Confirm password
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none ring-amber-500 focus:ring-2"
                    type="password"
                    value={adminPassword2}
                    onChange={(event) => setAdminPassword2(event.target.value)}
                    minLength={10}
                    required
                  />
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Creating admin..." : "Create admin"}
                </button>
              </form>
            </>
          ) : (
            <p className="mt-4 text-sm text-emerald-700">Bootstrap completed. Users in system: {bootstrap?.usersCount ?? 0}</p>
          )}
        </section>
      </div>
    </main>
  );
}
