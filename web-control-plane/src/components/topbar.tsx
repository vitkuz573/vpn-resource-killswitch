import { TopbarProfileMenu } from "@/components/topbar-profile";

type Props = {
  name: string;
  email: string;
  role: string;
};

export function Topbar({ name, email, role }: Props) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">VRKS Control Plane</p>
          <p className="text-sm text-muted-foreground">Secure runtime operations console</p>
        </div>

        <TopbarProfileMenu name={name} email={email} role={role} />
      </div>
    </header>
  );
}
