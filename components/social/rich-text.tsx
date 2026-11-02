import Link from "next/link";
import { Fragment } from "react";

/** Turns @mentions into profile links and #hashtags into search links. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/([@#][a-zA-Z0-9_.]{2,30})/g);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        if (p.startsWith("@") && p.length > 1)
          return (
            <Link key={i} href={`/u/${p.slice(1).replace(/\.$/, "").toLowerCase()}`} className="font-semibold text-accent-text hover:underline">
              {p}
            </Link>
          );
        if (p.startsWith("#") && p.length > 1)
          return (
            <Link key={i} href={`/explore?q=${encodeURIComponent(p.slice(1))}`} className="text-accent-text hover:underline">
              {p}
            </Link>
          );
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </span>
  );
}
