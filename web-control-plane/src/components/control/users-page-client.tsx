"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
        <Card className="col-span-12 border-amber-300 bg-amber-50/80">
          <CardHeader>
            <CardTitle className="text-2xl text-amber-900">Users</CardTitle>
            <CardDescription className="text-amber-800">
              Only ADMIN role can access user management.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="grid grid-cols-12 gap-4">
      <Card className="col-span-12">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-2xl">Users</CardTitle>
            <CardDescription>Role-based operator management and audit-friendly onboarding.</CardDescription>
          </div>
          <Button type="button" variant="outline" onClick={() => void refreshUsers()} disabled={loading}>
            Refresh users
          </Button>
        </CardHeader>
      </Card>

      <Card className="col-span-12">
        <CardHeader>
          <CardTitle>Create user</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-5" onSubmit={createUser}>
            <div className="space-y-2">
              <Label htmlFor="new-user-name">Name</Label>
              <Input
                id="new-user-name"
                value={newUserName}
                onChange={(event) => setNewUserName(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                type="email"
                value={newUserEmail}
                onChange={(event) => setNewUserEmail(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-user-password">Password</Label>
              <Input
                id="new-user-password"
                type="password"
                value={newUserPassword}
                onChange={(event) => setNewUserPassword(event.target.value)}
                required
                minLength={10}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-user-password2">Confirm</Label>
              <Input
                id="new-user-password2"
                type="password"
                value={newUserPassword2}
                onChange={(event) => setNewUserPassword2(event.target.value)}
                required
                minLength={10}
              />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <div className="flex gap-2">
                <Select value={newUserRole} onValueChange={(value) => setNewUserRole(value ?? "VIEWER")}>
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VIEWER">VIEWER</SelectItem>
                    <SelectItem value="OPERATOR">OPERATOR</SelectItem>
                    <SelectItem value="ADMIN">ADMIN</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={loading}>Add</Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="col-span-12 md:col-span-8">
        <CardHeader>
          <CardTitle>Directory</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="max-w-56 truncate">{user.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{user.role}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? "default" : "outline"}>
                      {user.isActive ? "active" : "disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(user.lastLoginAt)}</TableCell>
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="col-span-12 md:col-span-4">
        <CardHeader>
          <CardTitle>Output</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs">{output}</pre>
        </CardContent>
      </Card>
    </main>
  );
}
