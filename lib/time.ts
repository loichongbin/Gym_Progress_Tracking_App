import { differenceInDays, differenceInHours, differenceInMinutes, format } from "date-fns";

/** Instagram-style compact relative time: "now", "5m", "3h", "2d", "12 Oct". */
export function timeAgo(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const m = differenceInMinutes(now, d);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = differenceInHours(now, d);
  if (h < 24) return `${h}h`;
  const days = differenceInDays(now, d);
  if (days < 7) return `${days}d`;
  return format(d, d.getFullYear() === now.getFullYear() ? "d MMM" : "d MMM yyyy");
}

export const fullDate = (iso: string) => format(new Date(iso), "EEEE d MMMM · HH:mm");
