// Authentication service — Supabase Auth manages passwords (bcrypt), sessions and email flows.
// Nothing password-related is ever stored in our own tables.
import type { Profile, SignUpInput } from "@/lib/types";
import { AppError, db, emitChange, setCachedUserId, toAppError, unwrap, unwrapMaybe } from "./core";
import { toProfile } from "./mappers";

const origin = () => (typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");

type MyProfileRow = Parameters<typeof toProfile>[0];

/** The signed-in user's full profile (including private settings), or null. */
export async function getCurrentUser(): Promise<Profile | null> {
  const { data: session } = await db().auth.getSession();
  setCachedUserId(session.session?.user.id ?? null);
  if (!session.session) return null;
  const row = unwrapMaybe(await db().rpc("get_my_profile")) as unknown as MyProfileRow | null;
  return row ? toProfile(row) : null;
}

export async function getAccountEmail(): Promise<{ email: string | null; pendingEmail: string | null; verified: boolean }> {
  const { data } = await db().auth.getUser();
  return { email: data.user?.email ?? null, pendingEmail: data.user?.new_email ?? null, verified: !!data.user?.email_confirmed_at };
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  return Boolean(unwrap(await db().rpc("username_available", { p_username: username })));
}

/**
 * Registers a user. A profile row is created by a database trigger in the same
 * transaction. When email confirmation is enabled no session is returned yet.
 */
export async function signUp(input: SignUpInput): Promise<{ user: Profile | null; needsVerification: boolean }> {
  if (!(await isUsernameAvailable(input.username))) throw new AppError("That username is taken.", "username_taken");
  const { data, error } = await db().auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      data: { username: input.username.trim().toLowerCase(), full_name: input.full_name.trim() },
      emailRedirectTo: `${origin()}/auth/callback`,
    },
  });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) throw new AppError("An account with that email already exists.", "email_taken");
    if (/password/i.test(error.message)) throw new AppError(error.message, "weak_password");
    throw toAppError(error);
  }
  // Supabase returns a user with no identities when the email is already registered (anti-enumeration).
  if (data.user && data.user.identities?.length === 0) throw new AppError("An account with that email already exists.", "email_taken");
  if (!data.session) return { user: null, needsVerification: true };
  setCachedUserId(data.session.user.id);
  emitChange();
  return { user: await getCurrentUser(), needsVerification: false };
}

export async function signIn(email: string, password: string): Promise<Profile> {
  const { data, error } = await db().auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    if (/email not confirmed/i.test(error.message)) throw new AppError("Please verify your email first — check your inbox for the link.", "email_not_confirmed");
    if (/invalid login credentials/i.test(error.message)) throw new AppError("Incorrect email or password.", "invalid_credentials");
    throw toAppError(error);
  }
  setCachedUserId(data.user.id);
  const me = await getCurrentUser();
  if (!me) throw new AppError("Your profile could not be loaded.", "profile_missing");
  emitChange();
  return me;
}

export async function signOut() {
  await db().auth.signOut();
  setCachedUserId(null);
  emitChange();
}

export async function resendVerification(email: string) {
  const { error } = await db().auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: `${origin()}/auth/callback` } });
  if (error) throw toAppError(error);
}

export async function requestPasswordReset(email: string) {
  const { error } = await db().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${origin()}/reset-password` });
  if (error) throw toAppError(error);
}

export async function updatePassword(newPassword: string) {
  const { error } = await db().auth.updateUser({ password: newPassword });
  if (error) throw toAppError(error);
}

/** Changing the email sends a confirmation link to the new address. */
export async function updateEmail(newEmail: string) {
  const { error } = await db().auth.updateUser({ email: newEmail.trim() }, { emailRedirectTo: `${origin()}/auth/callback` });
  if (error) throw toAppError(error);
}

/**
 * Permanently deletes the account. Requires elevated privileges, so it runs in a
 * server Route Handler that verifies the caller's access token first.
 */
export async function deleteAccount() {
  const { data } = await db().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AppError("Please log in again to delete your account.", "unauthenticated");
  const res = await fetch("/api/account", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new AppError(body.error ?? "Could not delete your account.", "delete_failed");
  }
  await db().auth.signOut().catch(() => undefined);
  setCachedUserId(null);
  emitChange();
}

export function onAuthChange(cb: (user: Profile | null, event: string) => void) {
  const { data } = db().auth.onAuthStateChange((event, session) => {
    setCachedUserId(session?.user.id ?? null);
    // Defer DB calls out of the auth callback (recommended by supabase-js to avoid deadlocks).
    setTimeout(async () => {
      cb(session ? await getCurrentUser().catch(() => null) : null, event);
    }, 0);
  });
  return () => data.subscription.unsubscribe();
}
