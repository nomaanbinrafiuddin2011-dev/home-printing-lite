export interface Admin { id: string; email: string }
export interface Tokens { accessToken: string; refreshToken: string; expiresIn: number }
export interface AuthBackend {
  getUser(accessToken: string): Promise<Admin | null>;      // verifies the JWT with Supabase Auth (server-side)
  isAdmin(userId: string): Promise<boolean>;                 // checks the admin_users allow-list in the database
  refresh(refreshToken: string): Promise<Tokens | null>;
}
export type AuthResult =
  | { ok: true; admin: Admin; newTokens?: Tokens }
  | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'expired' | 'unavailable' };
export const AT = 'hps_at', RT = 'hps_rt';

/** Decides who the caller is from cookies only. Being a valid Supabase user is NOT enough: they must be on the admin allow-list. */
export async function authorize(backend: AuthBackend, cookies: Record<string, string>, allowRefresh: boolean): Promise<AuthResult> {
  try {
    const at = cookies[AT];
    if (at) { const u = await backend.getUser(at); if (u) return (await backend.isAdmin(u.id)) ? { ok: true, admin: u } : { ok: false, reason: 'forbidden' }; }
    const rt = cookies[RT];
    if (!rt) return { ok: false, reason: 'unauthenticated' };
    if (!allowRefresh) return { ok: false, reason: 'expired' };
    const t = await backend.refresh(rt); if (!t) return { ok: false, reason: 'unauthenticated' };
    const u = await backend.getUser(t.accessToken); if (!u) return { ok: false, reason: 'unauthenticated' };
    return (await backend.isAdmin(u.id)) ? { ok: true, admin: u, newTokens: t } : { ok: false, reason: 'forbidden' };
  } catch { return { ok: false, reason: 'unavailable' }; }
}
