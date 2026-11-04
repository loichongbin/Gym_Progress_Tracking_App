"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useToast } from "@/components/providers/toast";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/misc";
import { AppError, data } from "@/lib/data";

const schema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resending, setResending] = useState(false);
  const { register, handleSubmit, formState, getValues } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = async (v: Values) => {
    setError(null);
    setUnverified(false);
    try {
      const me = await data.signIn(v.email, v.password);
      toast(`Welcome back, ${me.full_name.split(" ")[0] || me.username} 💪`);
      router.replace("/home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
      setUnverified(e instanceof AppError && e.code === "email_not_confirmed");
    }
  };

  const resend = async () => {
    setResending(true);
    try {
      await data.resendVerification(getValues("email"));
      toast("Verification email sent — check your inbox", "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't resend the email", "error");
    } finally {
      setResending(false);
    }
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
        <div className="-mt-1 text-right">
          <Link href="/forgot-password" className="text-[13px] font-medium text-muted hover:text-fg">
            Forgot password?
          </Link>
        </div>
        {error && (
          <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
            {unverified && (
              <button type="button" onClick={resend} disabled={resending} className="mt-2 flex items-center gap-1.5 font-semibold text-fg underline-offset-4 hover:underline">
                <MailCheck className="size-4" /> {resending ? "Sending…" : "Resend verification email"}
              </button>
            )}
          </div>
        )}
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          Log in
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        New to Spotter?{" "}
        <Link href="/signup" className="font-semibold text-fg underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
