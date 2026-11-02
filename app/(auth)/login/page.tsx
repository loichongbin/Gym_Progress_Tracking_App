"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DemoNotice } from "@/components/demo-banner";
import { useToast } from "@/components/providers/toast";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/misc";
import { data, isDemoMode } from "@/lib/data";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/data/demo/seed";

const schema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, setValue, formState } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = async (v: Values) => {
    setError(null);
    try {
      const me = await data.signIn(v.email, v.password);
      toast(`Welcome back, ${me.full_name.split(" ")[0]} 💪`);
      router.replace("/home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    }
  };

  const demo = () => {
    setValue("email", DEMO_EMAIL);
    setValue("password", DEMO_PASSWORD);
    handleSubmit(onSubmit)();
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight">Welcome back</h1>
      <p className="mt-1.5 text-sm text-muted">Your crew has been busy. Let&apos;s catch up.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4" noValidate>
        <Field label="Email" error={formState.errors.email?.message}>
          <input {...register("email")} type="email" autoComplete="email" inputMode="email" className={inputClass} placeholder="you@example.com" />
        </Field>
        <Field label="Password" error={formState.errors.password?.message}>
          <input {...register("password")} type="password" autoComplete="current-password" className={inputClass} placeholder="••••••••" />
        </Field>
        {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          Log in
        </Button>
      </form>
      {isDemoMode && (
        <div className="mt-6 space-y-3">
          <div className="flex items-center gap-3 text-xs text-subtle">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <Button variant="secondary" size="lg" className="w-full" onClick={demo} disabled={formState.isSubmitting}>
            <Zap className="size-4 text-accent-text" /> Explore as demo athlete (Alex)
          </Button>
          <DemoNotice />
        </div>
      )}
      <p className="mt-8 text-center text-sm text-muted">
        New to Spotter?{" "}
        <Link href="/signup" className="font-semibold text-fg underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
