import Link from "next/link";
import type { Profile } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";

export function UserRow({ user, subtitle, action, onClick }: { user: Profile; subtitle?: React.ReactNode; action?: React.ReactNode; onClick?: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Link href={`/u/${user.username}`} onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar user={user} size="md" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{user.username}</div>
          <div className="truncate text-[13px] text-muted">{subtitle ?? user.full_name}</div>
        </div>
      </Link>
      {action}
    </div>
  );
}
