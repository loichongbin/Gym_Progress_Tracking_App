"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, KeyRound, LogOut, Mail, Moon, ShieldCheck, Sun, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useMe } from "@/components/providers/auth";
import { useTheme } from "@/components/providers/theme";
import { useAction, useToast } from "@/components/providers/toast";
import { PageHeader } from "@/components/shell/app-shell";
import { UserRow } from "@/components/social/user-row";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, Field, inputClass, Pills, Switch } from "@/components/ui/misc";
import { useData } from "@/hooks/use-data";
import { setActiveWorkout } from "@/lib/active-workout";
import { data } from "@/lib/data";
import { MediaError, validateMedia } from "@/lib/media";
import type { Profile, ProfileUpdate, Visibility } from "@/lib/types";
import { emailSchema, newPasswordSchema, profileSchema } from "@/lib/validation";
import { Sheet } from "@/components/ui/sheet";

type Values = z.infer<typeof profileSchema>;

function Section({ title, icon: Icon, children }: { title: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        {Icon && <Icon className="size-4 text-accent-text" />} {title}
      </h2>
      {children}
    </Card>
  );
}

function ProfileForm({ me }: { me: Profile }) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [avatar, setAvatar] = useState<{ file: File; url: string } | null>(null);
  const { register, handleSubmit, formState, reset } = useForm<Values>({
    resolver: zodResolver(profileSchema),
    defaultValues: { full_name: me.full_name, username: me.username, bio: me.bio, location: me.location ?? "", gym: me.gym ?? "", interests: me.interests.join(", ") },
  });

  const onSubmit = async (v: Values) => {
    try {
      const updated = await data.updateProfile({
        full_name: v.full_name,
        username: v.username,
        bio: v.bio,
        location: v.location.trim() || null,
        gym: v.gym.trim() || null,
        interests: v.interests.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8),
        avatar: avatar?.file ?? null,
      });
      setAvatar(null);
      reset({ ...v, username: updated.username });
      toast("Profile updated");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save profile", "error");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => fileInput.current?.click()} className="relative" aria-label="Change profile photo">
          {avatar ? <img src={avatar.url} alt="" className="size-20 rounded-full object-cover" /> : <Avatar user={me} size="xl" />}
          <span className="absolute bottom-0 right-0 flex size-7 items-center justify-center rounded-full border-2 border-surface bg-accent text-accent-fg">
            <Camera className="size-3.5" />
          </span>
        </button>
        <div className="text-sm text-muted">JPG, PNG or WebP. We&apos;ll resize it for you.</div>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              if ((await validateMedia(f)) !== "image") throw new MediaError("Profile photo must be an image");
              setAvatar({ file: f, url: URL.createObjectURL(f) });
            } catch (err) {
              toast(err instanceof Error ? err.message : "Invalid image", "error");
            }
          }}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={formState.errors.full_name?.message}>
          <input {...register("full_name")} className={inputClass} />
        </Field>
        <Field label="Username" error={formState.errors.username?.message}>
          <input {...register("username")} autoCapitalize="none" className={inputClass} />
        </Field>
      </div>
      <Field label="Bio" error={formState.errors.bio?.message}>
        <textarea {...register("bio")} rows={3} className={inputClass} placeholder="What are you training for?" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Location (optional)">
          <input {...register("location")} className={inputClass} placeholder="City" />
        </Field>
        <Field label="Gym (optional)">
          <input {...register("gym")} className={inputClass} placeholder="Where you train" />
        </Field>
      </div>
      <Field label="Fitness interests" hint="Comma separated, e.g. Powerlifting, Running, Push Pull Legs">
        <input {...register("interests")} className={inputClass} />
      </Field>
      <Button type="submit" loading={formState.isSubmitting} disabled={!formState.isDirty && !avatar}>
        Save profile
      </Button>
    </form>
  );
}

export default function SettingsPage() {
  const me = useMe();
  const run = useAction();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { data: blocked } = useData(() => data.getBlockedUsers(), []);
  const set = (u: ProfileUpdate) => run(() => data.updateProfile(u), "Privacy settings saved");

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" />
      <div className="space-y-4 p-4">
        <Section title="Edit profile">
          <ProfileForm key={me.id} me={me} />
        </Section>

        <Section title="Privacy" icon={ShieldCheck}>
          <div className="divide-y divide-line">
            <Switch checked={me.is_private} onChange={(v) => set({ is_private: v })} label="Private account" description="Only approved followers can see your posts, workouts and stories." />
            <Switch checked={me.show_workouts} onChange={(v) => set({ show_workouts: v })} label="Show workout log on profile" description="Turn off to keep your training history private. Workouts attached to posts remain visible with the post." />
            <Switch checked={me.show_prs} onChange={(v) => set({ show_prs: v })} label="Show personal records" />
            <Switch checked={me.show_gym} onChange={(v) => set({ show_gym: v })} label="Show gym on profile" />
            <Switch checked={me.show_location} onChange={(v) => set({ show_location: v })} label="Show location on profile" />
            <Switch checked={me.share_checkins} onChange={(v) => set({ share_checkins: v })} label="Share gym check-ins with followers" description="Followers see the gym name you check in at for 3 hours. Spotter never shares your live GPS location." />
            <div className="py-3">
              <div className="mb-2 text-sm font-medium">Default story audience</div>
              <Pills
                value={me.story_visibility}
                onChange={(v: Visibility) => set({ story_visibility: v })}
                options={[
                  { value: "public", label: "Everyone" },
                  { value: "followers", label: "Followers" },
                ]}
              />
            </div>
          </div>
        </Section>

        <Section title="Blocked accounts">
          {blocked?.length === 0 && <p className="text-sm text-muted">You haven&apos;t blocked anyone.</p>}
          <div className="-mx-4">
            {blocked?.map((u) => (
              <UserRow key={u.id} user={u} action={<Button size="sm" variant="secondary" onClick={() => run(() => data.unblockUser(u.id), `Unblocked @${u.username}`)}>Unblock</Button>} />
            ))}
          </div>
        </Section>

        <Section title="Appearance">
          <div className="grid grid-cols-2 gap-2">
            {(["dark", "light"] as const).map((t) => (
              <button key={t} onClick={() => setTheme(t)} className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold capitalize ${theme === t ? "border-accent bg-accent-soft" : "border-line"}`}>
                {t === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />} {t}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Account" icon={KeyRound}>
          <AccountSettings me={me} />
        </Section>

        <Button
          variant="danger"
          size="lg"
          className="w-full"
          onClick={async () => {
            setActiveWorkout(null);
            await data.signOut();
            router.replace("/login");
          }}
        >
          <LogOut className="size-4" /> Log out
        </Button>
      </div>
    </div>
  );
}

function AccountSettings({ me }: { me: Profile }) {
  const toast = useToast();
  const router = useRouter();
  const { data: account } = useData(() => data.getAccountEmail(), []);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const emailForm = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema) });
  const pwForm = useForm<z.infer<typeof newPasswordSchema>>({ resolver: zodResolver(newPasswordSchema) });

  return (
    <div className="space-y-6">
      <form
        className="space-y-2"
        noValidate
        onSubmit={emailForm.handleSubmit(async (v) => {
          try {
            await data.updateEmail(v.email);
            emailForm.reset();
            toast(`Confirmation link sent to ${v.email}`, "info");
          } catch (e) {
            emailForm.setError("email", { message: e instanceof Error ? e.message : "Couldn't change email" });
          }
        })}
      >
        <Field label={`Email${account?.email ? ` · currently ${account.email}` : ""}`} error={emailForm.formState.errors.email?.message} hint={account?.pendingEmail ? `Waiting for confirmation of ${account.pendingEmail}` : undefined}>
          <div className="flex gap-2">
            <input {...emailForm.register("email")} type="email" placeholder="new@email.com" className={inputClass} />
            <Button type="submit" variant="secondary" loading={emailForm.formState.isSubmitting}>
              <Mail className="size-4" /> Change
            </Button>
          </div>
        </Field>
      </form>

      <form
        className="space-y-3"
        noValidate
        onSubmit={pwForm.handleSubmit(async (v) => {
          try {
            await data.updatePassword(v.password);
            pwForm.reset();
            toast("Password updated");
          } catch (e) {
            pwForm.setError("password", { message: e instanceof Error ? e.message : "Couldn't update password" });
          }
        })}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New password" error={pwForm.formState.errors.password?.message}>
            <input {...pwForm.register("password")} type="password" autoComplete="new-password" className={inputClass} />
          </Field>
          <Field label="Confirm new password" error={pwForm.formState.errors.confirm?.message}>
            <input {...pwForm.register("confirm")} type="password" autoComplete="new-password" className={inputClass} />
          </Field>
        </div>
        <Button type="submit" variant="secondary" loading={pwForm.formState.isSubmitting}>
          Update password
        </Button>
      </form>

      <div className="rounded-xl border border-danger/30 p-4">
        <div className="text-sm font-semibold text-danger">Delete account</div>
        <p className="mt-1 text-xs text-muted">Permanently deletes your profile, posts, workouts, stories, comments and uploaded media. This cannot be undone.</p>
        <Button variant="danger" size="sm" className="mt-3" onClick={() => setDeleting(true)}>
          <Trash2 className="size-4" /> Delete my account
        </Button>
      </div>

      <Sheet open={deleting} onClose={() => setDeleting(false)} title="Delete account">
        <div className="space-y-3 p-4">
          <p className="text-sm text-muted">
            Type <b className="text-fg">{me.username}</b> to confirm. Everything you&apos;ve shared will be removed for good.
          </p>
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={inputClass} autoCapitalize="none" aria-label="Type your username to confirm" />
          <Button
            variant="danger"
            className="w-full"
            disabled={confirmText.trim().toLowerCase() !== me.username || busy}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setActiveWorkout(null);
                await data.deleteAccount();
                toast("Your account has been deleted", "info");
                router.replace("/");
              } catch (e) {
                toast(e instanceof Error ? e.message : "Couldn't delete account", "error");
                setBusy(false);
              }
            }}
          >
            Permanently delete
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
