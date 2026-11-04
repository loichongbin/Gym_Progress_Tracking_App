import { Database } from "lucide-react";
import { Logo } from "@/components/logo";

/** Shown instead of the app when the Supabase environment variables are missing. */
export function SetupRequired() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <Logo />
      <div className="mt-10 rounded-[var(--radius-card)] border border-line bg-surface p-6">
        <Database className="size-6 text-accent-text" />
        <h1 className="mt-4 font-display text-2xl font-bold">Connect your Supabase project</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Spotter stores every account, post, workout and upload in Supabase. Add your project&apos;s URL and publishable key to{" "}
          <code className="rounded bg-surface-2 px-1">.env.local</code>, run the migrations, then restart the dev server.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-surface-2 p-3 text-xs leading-relaxed">
{`NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`}
        </pre>
        <p className="mt-4 text-xs text-subtle">Full step-by-step instructions are in the README (&ldquo;Backend setup&rdquo;).</p>
      </div>
    </main>
  );
}
