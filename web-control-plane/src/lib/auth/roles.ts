export const ROLES = {
  ADMIN: "ADMIN",
  OPERATOR: "OPERATOR",
  VIEWER: "VIEWER",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LEVEL: Record<Role, number> = {
  ADMIN: 3,
  OPERATOR: 2,
  VIEWER: 1,
};

export function hasRole(current: Role | string | null | undefined, minimum: Role): boolean {
  if (!current || !(current in ROLE_LEVEL)) {
    return false;
  }
  return ROLE_LEVEL[current as Role] >= ROLE_LEVEL[minimum];
}
