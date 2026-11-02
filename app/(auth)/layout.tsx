"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/logo";
import { useAuth } from "@/components/providers/auth";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (user) router.replace("/home");
  }, [user, router]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-8">
      <Link href="/" aria-label="Spotter home">
        <Logo />
      </Link>
      <div className="mt-10 flex-1">{children}</div>
    </main>
  );
}
