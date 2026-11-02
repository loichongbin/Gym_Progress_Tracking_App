"use client";

import { Ban, Camera, Dumbbell, Flag, Grid3x3, LineChart, Lock, MapPin, MoreHorizontal, Settings, Share2, Zap } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useMe } from "@/components/providers/auth";
import { useAction, useToast } from "@/components/providers/toast";
import { PageHeader } from "@/components/shell/app-shell";
import { ProgressDashboard } from "@/components/progress/dashboard";
import { FollowButton } from "@/components/social/follow-button";
import { ReportSheet } from "@/components/social/post-menu";
import { PostGrid } from "@/components/social/post-grid";
import { UserRow } from "@/components/social/user-row";
import { StoryViewer } from "@/components/stories/story-viewer";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState, inputClass, Skeleton, Tabs } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { WorkoutCard } from "@/components/workout/workout-card";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";
import { formatCount } from "@/lib/fitness";
import type { Profile } from "@/lib/types";

type Tab = "posts" | "workouts" | "progress";

function PeopleSheet({ title, open, onClose, load }: { title: string; open: boolean; onClose: () => void; load: () => Promise<Profile[]> }) {
  const me = useMe();
  const { data: people } = useData(load, [open, title], { live: false });
  const [q, setQ] = useState("");
  const list = people?.filter((p) => !q || p.username.includes(q.toLowerCase()) || p.full_name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Sheet open={open} onClose={onClose} title={title} full>
      <div className="p-4 pb-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className={inputClass} />
      </div>
      {list?.map((p) => (
        <UserRow key={p.id} user={p} onClick={onClose} action={p.id === me.id ? null : <FollowButtonFor user={p} />} />
      ))}
      {list?.length === 0 && <p className="p-6 text-center text-sm text-muted">Nobody here yet.</p>}
    </Sheet>
  );
}

function FollowButtonFor({ user }: { user: Profile }) {
  const { data: view } = useData(() => data.getProfile(user.username), [user.username], { live: false });
  if (!view) return <Skeleton className="h-8 w-20" />;
  return <FollowButton userId={user.id} status={view.follow_status} followsYou={view.follows_you} />;
}

function InviteSheet({ open, onClose, user }: { open: boolean; onClose: () => void; user: Profile }) {
  const run = useAction();
  const [msg, setMsg] = useState("Leg day tomorrow 6pm?");
  return (
    <Sheet open={open} onClose={onClose} title={`Invite ${user.full_name.split(" ")[0]} to train`}>
      <form
        className="space-y-3 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(async () => {
            await data.inviteToWorkout([user.id], msg);
            return true;
          }, `Invite sent to @${user.username} 💪`);
          if (ok) onClose();
        }}
      >
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={140} rows={3} className={inputClass} />
        <div className="flex flex-wrap gap-2">
          {["Push day tonight?", "Leg day tomorrow 6pm?", "Morning session before class?"].map((s) => (
            <button type="button" key={s} onClick={() => setMsg(s)} className="rounded-full bg-surface-2 px-3 py-1.5 text-xs">
              {s}
            </button>
          ))}
        </div>
        <Button type="submit" className="w-full" disabled={!msg.trim()}>
          Send invite
        </Button>
      </form>
    </Sheet>
  );
}

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const me = useMe();
  const run = useAction();
  const toast = useToast();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("posts");
  const [sheet, setSheet] = useState<"followers" | "following" | null>(null);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [invite, setInvite] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);

  const { data: profile, loading } = useData(() => data.getProfile(username), [username]);
  const canView = profile?.can_view ?? false;
  const { data: posts } = useData(() => (profile && canView ? data.getUserPosts(profile.id) : Promise.resolve([])), [profile?.id, canView]);
  const { data: workouts } = useData(() => (profile && canView ? data.getUserWorkouts(profile.id) : Promise.resolve([])), [profile?.id, canView]);
  const { data: tray } = useData(() => data.getStoryTray(), []);
  const storyGroup = tray?.find((g) => g.user.id === profile?.id);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="flex items-center gap-6">
          <Skeleton className="size-24 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
      </div>
    );
  }
  if (!profile) return <EmptyState icon={Ban} title="This profile isn't available" body="The link may be broken, or the account may have been removed." />;

  const isMe = profile.id === me.id;
  const share = async () => {
    const url = `${location.origin}/u/${profile.username}`;
    if (navigator.share) await navigator.share({ title: `${profile.full_name} on Spotter`, url }).catch(() => undefined);
    else {
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      toast("Profile link copied");
    }
  };

  const stats = [
    { label: "Posts", value: profile.posts_count },
    { label: "Followers", value: profile.followers_count, onClick: canView ? () => setSheet("followers") : undefined },
    { label: "Following", value: profile.following_count, onClick: canView ? () => setSheet("following") : undefined },
    { label: "Workouts", value: profile.workouts_count },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={
          <span className="flex items-center gap-1.5">
            {profile.is_private && <Lock className="size-4" />}
            {profile.username}
          </span>
        }
        right={
          isMe ? (
            <Link href="/settings" className="rounded-full p-2" aria-label="Settings">
              <Settings className="size-6" />
            </Link>
          ) : (
            <button onClick={() => setMenu(true)} className="rounded-full p-2" aria-label="More options">
              <MoreHorizontal className="size-6" />
            </button>
          )
        }
      />

      <section className="px-4 pt-5">
        <div className="flex items-center gap-5 md:gap-10">
          <button onClick={() => storyGroup && setStoryOpen(true)} disabled={!storyGroup} aria-label={storyGroup ? "View story" : undefined} className="shrink-0">
            <Avatar user={profile} size="2xl" ring={!!storyGroup} seen={!storyGroup?.has_unseen} />
          </button>
          <div className="grid flex-1 grid-cols-4 gap-1 text-center">
            {stats.map((s) => (
              <button key={s.label} onClick={s.onClick} disabled={!s.onClick} className="min-w-0 rounded-xl py-1 enabled:hover:bg-surface-2">
                <div className="tabular font-display text-lg font-bold">{formatCount(s.value)}</div>
                <div className="truncate text-xs text-muted">{s.label}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <h1 className="font-semibold">{profile.full_name}</h1>
          {profile.bio && <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{profile.bio}</p>}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
            {profile.location && (profile.show_location || isMe) && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" /> {profile.location}
              </span>
            )}
            {profile.gym && (profile.show_gym || isMe) && (
              <Link href={`/explore?q=${encodeURIComponent(profile.gym)}`} className="flex items-center gap-1 hover:text-fg">
                <Dumbbell className="size-3.5" /> {profile.gym}
              </Link>
            )}
          </div>
          {profile.interests.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {profile.interests.map((i) => (
                <Link key={i} href={`/explore?q=${encodeURIComponent(i)}`} className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent-text">
                  {i}
                </Link>
              ))}
            </div>
          )}
          {!isMe && profile.follows_you && <p className="mt-2 text-xs text-muted">Follows you</p>}
        </div>

        <div className="mt-4 flex gap-2">
          {isMe ? (
            <>
              <Link href="/settings" className="flex-1">
                <Button variant="secondary" size="sm" className="w-full">
                  Edit profile
                </Button>
              </Link>
              <Button variant="secondary" size="sm" className="flex-1" onClick={share}>
                <Share2 className="size-3.5" /> Share profile
              </Button>
            </>
          ) : profile.is_blocked ? (
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => run(() => data.unblockUser(profile.id), "Unblocked")}>
              Unblock
            </Button>
          ) : (
            <>
              <FollowButton userId={profile.id} status={profile.follow_status} followsYou={profile.follows_you} className="flex-1" />
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => setInvite(true)}>
                <Zap className="size-3.5" /> Invite to train
              </Button>
            </>
          )}
        </div>
      </section>

      {!canView ? (
        <div className="mt-6 border-t border-line">
          <EmptyState icon={Lock} title="This account is private" body={profile.follow_status === "pending" ? "Your follow request is pending." : "Follow this account to see their posts and workouts."} />
        </div>
      ) : (
        <>
          <Tabs
            className="mt-6"
            value={tab}
            onChange={setTab}
            layoutId="profile-tabs"
            tabs={[
              { value: "posts", label: <><Grid3x3 className="size-4" /> Posts</> },
              { value: "workouts", label: <><Dumbbell className="size-4" /> Workouts</> },
              { value: "progress", label: <><LineChart className="size-4" /> Progress</> },
            ]}
          />
          {tab === "posts" &&
            (posts?.length === 0 ? (
              <EmptyState icon={Camera} title={isMe ? "Share your first post" : "No posts yet"} body={isMe ? "Post a gym selfie, a clip or your latest session." : undefined} action={isMe ? <Link href="/create/post"><Button>Create a post</Button></Link> : undefined} />
            ) : (
              <div className="pt-0.5">
                <PostGrid posts={posts ?? []} />
              </div>
            ))}
          {tab === "workouts" &&
            (!profile.show_workouts && !isMe ? (
              <EmptyState icon={Lock} title="Workouts are private" body={`${profile.full_name.split(" ")[0]} keeps their training log private.`} />
            ) : workouts?.length === 0 ? (
              <EmptyState icon={Dumbbell} title="No workouts yet" action={isMe ? <Link href="/workout"><Button>Start a workout</Button></Link> : undefined} />
            ) : (
              <div className="space-y-3 p-4">{workouts?.map((w) => <WorkoutCard key={w.id} w={w} />)}</div>
            ))}
          {tab === "progress" && (
            <div className="p-4">
              <ProgressDashboard userId={profile.id} workouts={workouts ?? []} isMe={isMe} showPrs={profile.show_prs || isMe} />
            </div>
          )}
        </>
      )}

      <PeopleSheet title="Followers" open={sheet === "followers"} onClose={() => setSheet(null)} load={() => data.getFollowers(profile.id)} />
      <PeopleSheet title="Following" open={sheet === "following"} onClose={() => setSheet(null)} load={() => data.getFollowing(profile.id)} />
      {!isMe && <InviteSheet open={invite} onClose={() => setInvite(false)} user={profile} />}
      <Sheet open={menu} onClose={() => setMenu(false)}>
        <div className="p-2 pb-4">
          <button onClick={() => { setMenu(false); share(); }} className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-sm font-medium hover:bg-surface-2">
            <Share2 className="size-5" /> Share profile
          </button>
          <button onClick={() => { setMenu(false); setReporting(true); }} className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-sm font-medium text-danger hover:bg-surface-2">
            <Flag className="size-5" /> Report
          </button>
          <button
            onClick={async () => {
              setMenu(false);
              if (profile.is_blocked) await run(() => data.unblockUser(profile.id), "Unblocked");
              else if (confirm(`Block @${profile.username}? They won't be able to find your profile, posts or stories.`)) {
                await run(() => data.blockUser(profile.id), `Blocked @${profile.username}`);
                router.push("/home");
              }
            }}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-sm font-medium text-danger hover:bg-surface-2"
          >
            <Ban className="size-5" /> {profile.is_blocked ? "Unblock" : "Block"}
          </button>
        </div>
      </Sheet>
      <ReportSheet open={reporting} onClose={() => setReporting(false)} targetType="user" targetId={profile.id} />
      {storyOpen && storyGroup && <StoryViewer groups={[storyGroup]} startIndex={0} onClose={() => setStoryOpen(false)} />}
    </div>
  );
}
