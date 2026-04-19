import { signOut } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  name: string;
  email: string;
  role: string;
};

export function Topbar({ name, email, role }: Props) {
  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">VRKS Control Plane</p>
          <p className="text-sm text-muted-foreground">Next.js + TypeScript + shadcn/ui</p>
        </div>

        <div className="flex items-center gap-3 text-right">
          <div>
            <p className="text-sm font-semibold">{name || email}</p>
            <p className="text-xs text-muted-foreground">
              {email} · <Badge variant="secondary">{role}</Badge>
            </p>
          </div>
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
