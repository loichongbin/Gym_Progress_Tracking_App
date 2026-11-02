import Link from "next/link";
import { LogoMark } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <LogoMark className="size-12" />
      <h1 className="mt-6 font-display text-3xl font-bold">Rest day for this page</h1>
      <p className="mt-2 text-muted">We couldn&apos;t find what you were looking for.</p>
      <Link href="/home" className="mt-6 rounded-2xl bg-accent px-5 py-3 font-semibold text-accent-fg">
        Back to the feed
      </Link>
    </main>
  );
}
