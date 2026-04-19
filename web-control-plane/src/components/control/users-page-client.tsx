"use client";

import { useEffect, useState } from "react";

import { formatDate, parseResponse } from "@/lib/control-plane-client";

type Props = {
  userRole: string;
};

type UserItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
};

export function UsersPageClient({ userRole }: Props) {
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [output, setOutput] = useState("(idle)");

  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserPassword2, setNewUserPassword2] = useState("");
  const [newUserRole, setNewUserRole] = useState("VIEWER");

  const isAdmin = userRole === "ADMIN";

  async function refreshUsers(): Promise<void> {
    if (!isAdmin) {
      return;
    }
    const response = await fetch("/api/auth/users", { cache: "no-store" });
    const data = await parseResponse<{ users: UserItem[] }>(response);
    setUsers(data.users || []);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshUsers().catch((error: unknown) => {
        setOutput(error instanceof Error ? error.message : "Failed to load users");
      });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function createUser(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newUserName,
          email: newUserEmail,
          password: newUserPassword,
          confirmPassword: newUserPassword2,
          role: newUserRole,
        }),
      });
      await parseResponse(response);
      setOutput(`User ${newUserEmail} created.`);
      setNewUserName("");
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserPassword2("");
      setNewUserRole("VIEWER");
      await refreshUsers();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "User creation failed");
    } finally {
      setLoading(false);
    }
  }

  if (!isAdmin) {
    return (
      <main className="grid grid-cols-12 gap-4">
        <section className="col-span-12 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <h1 className="text-2xl font-bold text-amber-900">Users</h1>
          <p className="mt-2 text-sm text-amber-800">Only ADMIN role can access user management.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="grid grid-cols-12 gap-4">
      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Users</h1>
            <p className="text-sm text-slate-600">Role-based operator management and audit-friendly onboarding.</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshUsers()}
            disabled={loading}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
          >
            Refresh users
          </button>
        </div>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Create user</h2>
        <form className="mt-3 grid gap-3 md:grid-cols-5" onSubmit={createUser}>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Name"
            value={newUserName}
            onChange={(event) => setNewUserName(event.target.value)}
            required
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Email"
            type="email"
            value={newUserEmail}
            onChange={(event) => setNewUserEmail(event.target.value)}
            required
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Password"
            type="password"
            value={newUserPassword}
            onChange={(event) => setNewUserPassword(event.target.value)}
            required
            minLength={10}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Confirm"
            type="password"
            value={newUserPassword2}
            onChange={(event) => setNewUserPassword2(event.target.value)}
            required
            minLength={10}
          />
          <div className="flex gap-2">
            <select
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm"
              value={newUserRole}
              onChange={(event) => setNewUserRole(event.target.value)}
            >
              <option value="VIEWER">VIEWER</option>
              <option value="OPERATOR">OPERATOR</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg border border-indigo-700 bg-indigo-700 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </form>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-8">
        <h2 className="text-lg font-semibold">Directory</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Email</th>
                <th className="px-2 py-2">Role</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Last login</th>
                <th className="px-2 py-2">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-2 py-2 font-medium text-slate-800">{user.name}</td>
                  <td className="px-2 py-2 text-slate-700">{user.email}</td>
                  <td className="px-2 py-2">{user.role}</td>
                  <td className="px-2 py-2">{user.isActive ? "active" : "disabled"}</td>
                  <td className="px-2 py-2 text-slate-600">{formatDate(user.lastLoginAt)}</td>
                  <td className="px-2 py-2 text-slate-600">{formatDate(user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-4">
        <h2 className="text-lg font-semibold">Output</h2>
        <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{output}</pre>
      </section>
    </main>
  );
}
