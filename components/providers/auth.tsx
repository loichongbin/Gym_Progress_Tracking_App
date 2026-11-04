"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { SetupRequired } from "@/components/setup-required";
import { data, isSupabaseConfigured, realtime } from "@/lib/data";
import { emitChange } from "@/lib/services/core";
import type { Profile } from "@/lib/types";

interface AuthState {
  user: Profile | null;
  loading: boolean;
  /** Last auth event from Supabase (e.g. PASSWORD_RECOVERY) for pages that need it. */
  lastEvent: string | null;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, lastEvent: null, refresh: async () => {} });

function AuthProviderInner({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUser(await data.getCurrentUser());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Restores the persisted Supabase session on page load / refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async session restore
    refresh();
    const offAuth = data.onAuthChange((u, event) => {
      setUser(u);
      setLastEvent(event);
      setLoading(false);
    });
    // Profile edits (avatar, username…) are reflected in the shell immediately.
    const offData = data.subscribe(() => void data.getCurrentUser().then(setUser).catch(() => undefined));
    return () => {
      offAuth();
      offData();
    };
  }, [refresh]);

  // One narrowly-filtered realtime channel per signed-in user: their own notifications.
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    return realtime.subscribeToNotifications(uid, emitChange);
  }, [uid]);

  return <AuthContext.Provider value={{ user, loading, lastEvent, refresh }}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured) return <SetupRequired />;
  return <AuthProviderInner>{children}</AuthProviderInner>;
}

export const useAuth = () => useContext(AuthContext);

/** For pages inside the authenticated shell, where a user is guaranteed. */
export function useMe(): Profile {
  const { user } = useAuth();
  if (!user) throw new Error("useMe() used outside an authenticated route");
  return user;
}
