/**
 * The single source of truth for who may see the admin dashboard. Shared by the
 * dashboard page (src/admin/main.ts) and the in-game "Admin Dashboard" button
 * (src/slice3d/main.ts). Lowercased; compared case-insensitively.
 */
export const ADMIN_EMAILS = ['mattjohnson912@gmail.com'];

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}
