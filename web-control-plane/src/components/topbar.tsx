import { signOut } from "@/auth";

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
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">VRKS Control Plane</p>
          <p className="text-sm text-slate-600">Next.js + TypeScript + Tailwind</p>
        </div>

        <div className="flex items-center gap-3 text-right">
          <div>
            <p className="text-sm font-semibold text-slate-900">{name || email}</p>
            <p className="text-xs text-slate-500">
              {email} · <span className="font-semibold text-slate-700">{role}</span>
            </p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
