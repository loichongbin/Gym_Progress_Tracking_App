"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/components/providers/auth";

export default function MyProfileRedirect() {
  const me = useMe();
  const router = useRouter();
  useEffect(() => router.replace(`/u/${me.username}`), [me.username, router]);
  return null;
}
