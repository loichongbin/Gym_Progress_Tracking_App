"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Logo } from "@/components/logo";
import { useAuth } from "@/components/providers/auth";
import { useToast } from "@/components/providers/toast";
import { Button } from "@/components/ui/button";
import { Field, inputClass, Spinner } from "@/components/ui/misc";
import { data } from "@/lib/data";
import { newPasswordSchema } from "@/lib/validation";

type Values = z.infer<typeof newPasswordSchema>;

/** Landing page for the password-recovery email link (Supabase signs the user in temporarily). */
export default function ResetPasswordPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { register, handleSubmit, formState, setError } = useForm<Values>({ resolver: zodResolver(newPasswordSchema) });

  const onSubmit = async (v: Values) => {
    try {
      await data.updatePassword(v.password);
      toast("Password updated — you're signed in");
      router.replace("/home");
    } catch (e) {
      setError("password", { message: e instanceof Error ? e.message : "Couldn't update the password" });
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-8">
      <Logo />
      <div className="mt-10">
        <h1 className="font-display text-3xl font-bold tracking-tight">Choose a new password</h1>
        {loading ? (
          <Spinner className="mt-8" />
        ) : !user ? (
          <p className="mt-3 text-sm text-muted">
            This reset link is invalid or has expired.{" "}
            <Link href="/forgot-password" className="font-semibold text-fg underline-offset-4 hover:underline">
              Request a new one
            </Link>
            .
          </p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4" noValidate>
            <Field label="New password" error={formState.errors.password?.message}>
              <input {...register("password")} type="password" autoComplete="new-password" className={inputClass} />
            </Field>
            <Field label="Confirm password" error={formState.errors.confirm?.message}>
              <input {...register("confirm")} type="password" autoComplete="new-password" className={inputClass} />
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
              Update password
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
