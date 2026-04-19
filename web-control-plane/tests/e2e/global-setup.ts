import { execFileSync } from "node:child_process";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "e2e-admin@vrks.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "E2E_Admin#12345";
const ADMIN_NAME = process.env.E2E_ADMIN_NAME || "E2E Admin";

export default async function globalSetup() {
  const env = {
    ...process.env,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    ADMIN_NAME,
  };

  execFileSync("npm", ["run", "prisma:push"], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });

  execFileSync("npm", ["run", "seed:admin"], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
}
