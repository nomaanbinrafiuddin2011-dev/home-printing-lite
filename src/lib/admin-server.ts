import { createClient } from '@supabase/supabase-js';
import { serviceClient } from './supabase';
import { guardWith, json } from './admin-http';
import type { Guard } from './admin-http';
import { supabaseAdminStore, supabaseAuthBackend } from './admin-store-supabase';
import type { AdminStore } from './admin-store';
import type { AuthBackend } from './admin-auth';

const anon = () => { const u = process.env.NEXT_PUBLIC_SUPABASE_URL, k = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; return u && k ? createClient(u, k, { auth: { persistSession: false } }) : null; };
export const secureCookies = () => process.env.NODE_ENV === 'production';
export function authBackend(): AuthBackend | null { const db = serviceClient(), a = anon(); return db && a ? supabaseAuthBackend(db, a) : null; }
export const adminStore = (): AdminStore | null => { const db = serviceClient(); return db ? supabaseAdminStore(db) : null; };
export const anonClient = anon;

/** Runs `fn` only for an authorised admin. Never trusts the browser: session + allow-list are verified on every call. */
export async function withAdmin(req: Request, write: boolean, fn: (c: { admin: Extract<Guard, { ok: true }>['admin']; store: AdminStore }) => Promise<{ data: unknown; status?: number }>): Promise<Response> {
  const g = await guardWith(authBackend(), req, write, secureCookies());
  if (!g.ok) return g.response;
  const store = adminStore(); if (!store) return json({ ok: false, error: 'The admin area is not set up yet.' }, 503);
  try { const r = await fn({ admin: g.admin, store }); return json(r.data, r.status ?? 200, g.setCookies); }
  catch { return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500, g.setCookies); }
}
export const fromAct = (a: { ok: boolean; status?: number; error?: string; code?: string; data?: unknown }) => a.ok ? { data: { ok: true, ...(a.data as object | undefined) } } : { data: { ok: false, error: a.error, code: a.code }, status: a.status };
