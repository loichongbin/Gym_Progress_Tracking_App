"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { data } from "@/lib/data";
import type { Profile } from "@/lib/types";

interface AuthState {
  user: Profile | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, refresh: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await data.getCurrentUser());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const offAuth = data.onAuthChange((u) => setUser(u));
    // Profile edits (avatar, username…) should be reflected in the shell immediately.
    const offData = data.subscribe(() => void data.getCurrentUser().then(setUser));
    return () => {
      offAuth();
      offData();
    };
  }, [refresh]);

  return <AuthContext.Provider value={{ user, loading, refresh }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** For pages inside the authenticated shell, where a user is guaranteed. */
export function useMe(): Profile {
  const { user } = useAuth();
  if (!user) throw new Error("useMe() used outside an authenticated route");
  return user;
}
