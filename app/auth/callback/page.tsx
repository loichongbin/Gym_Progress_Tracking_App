"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { useAuth } from "@/components/providers/auth";
import { Spinner } from "@/components/ui/misc";

/**
 * Target of the verification / email-change links. supabase-js reads the tokens from the
 * URL (detectSessionInUrl) and establishes the session; we then send the user into the app.
 */
export default function AuthCallbackPage() {
  const { user, loading, lastEvent } = useAuth();
  const router = useRouter();
  const [linkError] = useState(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1));
    return params.get("error_description");
  });

  useEffect(() => {
    if (lastEvent === "PASSWORD_RECOVERY") router.replace("/reset-password");
    else if (user) {
      const t = setTimeout(() => router.replace("/home"), 1200);
      return () => clearTimeout(t);
    }
  }, [user, lastEvent, router]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-8">
      <Logo />
      <div className="mt-16 text-center">
        {linkError ? (
          <>
            <h1 className="font-display text-2xl font-bold">This link didn&apos;t work</h1>
            <p className="mt-2 text-sm text-muted">{linkError}</p>
            <Link href="/login" className="mt-6 inline-block font-semibold underline-offset-4 hover:underline">
              Back to log in
            </Link>
          </>
        ) : user ? (
          <>
            <CheckCircle2 className="mx-auto size-12 text-accent-text" />
            <h1 className="mt-4 font-display text-2xl font-bold">Email verified</h1>
            <p className="mt-2 text-sm text-muted">Taking you to your feed…</p>
          </>
        ) : loading ? (
          <Spinner className="mx-auto" />
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold">Almost there</h1>
            <p className="mt-2 text-sm text-muted">Your email is confirmed. Log in to continue.</p>
            <Link href="/login" className="mt-6 inline-block font-semibold underline-offset-4 hover:underline">
              Log in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
