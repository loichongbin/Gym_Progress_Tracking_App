"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/misc";
import { data } from "@/lib/data";
import { emailSchema } from "@/lib/validation";

type Values = z.infer<typeof emailSchema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(emailSchema) });

  const onSubmit = async (v: Values) => {
    setError(null);
    try {
      await data.requestPasswordReset(v.email);
      setSent(v.email);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the reset email");
    }
  };

  if (sent)
    return (
      <div className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent-soft">
          <MailCheck className="size-6 text-accent-text" />
        </div>
        <h1 className="mt-6 font-display text-3xl font-bold tracking-tight">Check your inbox</h1>
        <p className="mt-2 text-sm text-muted">
          If an account exists for <b className="text-fg">{sent}</b>, you&apos;ll receive a link to choose a new password.
        </p>
        <Link href="/login" className="mt-8 inline-block text-sm font-semibold underline-offset-4 hover:underline">
          Back to log in
        </Link>
      </div>
    );

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 text-sm text-muted">Enter your account email and we&apos;ll send you a reset link.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4" noValidate>
        <Field label="Email" error={formState.errors.email?.message}>
          <input {...register("email")} type="email" autoComplete="email" inputMode="email" className={inputClass} placeholder="you@example.com" />
        </Field>
        {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          Send reset link
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-fg underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
