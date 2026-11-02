"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { signUpSchema } from "@/lib/validation";
import { DemoNotice } from "@/components/demo-banner";
import { useToast } from "@/components/providers/toast";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/misc";
import { data } from "@/lib/data";

type Values = z.infer<typeof signUpSchema>;

export default function SignUpPage() {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(signUpSchema) });

  const onSubmit = async (v: Values) => {
    setError(null);
    try {
      await data.signUp(v);
      toast("You're in! Welcome to Spotter 🎉");
      router.replace("/home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign up failed");
    }
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight">Join the crew</h1>
      <p className="mt-1.5 text-sm text-muted">Share your sessions. Follow your friends. Grow stronger together.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4" noValidate>
        <Field label="Full name" error={formState.errors.full_name?.message}>
          <input {...register("full_name")} autoComplete="name" className={inputClass} placeholder="Alex Tan" />
        </Field>
        <Field label="Username" error={formState.errors.username?.message}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle">@</span>
            <input {...register("username")} autoCapitalize="none" autoCorrect="off" className={inputClass + " pl-8"} placeholder="alex.lifts" />
          </div>
        </Field>
        <Field label="Email" error={formState.errors.email?.message}>
          <input {...register("email")} type="email" autoComplete="email" inputMode="email" className={inputClass} placeholder="you@example.com" />
        </Field>
        <Field label="Password" error={formState.errors.password?.message}>
          <input {...register("password")} type="password" autoComplete="new-password" className={inputClass} placeholder="At least 8 characters" />
        </Field>
        {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          Create account
        </Button>
      </form>
      <DemoNotice className="mt-5" />
      <p className="mt-8 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-fg underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
