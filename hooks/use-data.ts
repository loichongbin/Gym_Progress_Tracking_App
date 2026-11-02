"use client";

import { useEffect, useRef, useState } from "react";
import { data } from "@/lib/data";

interface State<T> {
  key: string | null;
  value?: T;
  error: string | null;
}

/**
 * Fetch from the data service and refetch whenever anything changes
 * (likes, new posts, follows…).
 *
 * - `live: false` fetches once per `deps` change (no auto-refresh).
 * - `keepPrevious: true` keeps showing the last result while new deps load (e.g. pagination).
 */
export function useData<T>(fetcher: () => Promise<T>, deps: unknown[] = [], opts: { live?: boolean; keepPrevious?: boolean } = {}) {
  const key = JSON.stringify(deps);
  const [state, setState] = useState<State<T>>({ key: null, error: null });
  const fetcherRef = useRef(fetcher);
  const keyRef = useRef(key);

  useEffect(() => {
    fetcherRef.current = fetcher;
    keyRef.current = key;
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const value = await fetcherRef.current();
        if (alive && keyRef.current === key) setState({ key, value, error: null });
      } catch (e) {
        if (alive && keyRef.current === key) setState((s) => ({ ...s, key, error: e instanceof Error ? e.message : "Failed to load" }));
      }
    };
    load();
    const off = opts.live === false ? undefined : data.subscribe(() => void load());
    return () => {
      alive = false;
      off?.();
    };
  }, [key, opts.live]);

  const fresh = state.key === key;
  const value = fresh || opts.keepPrevious ? state.value : undefined;
  return {
    data: value,
    error: fresh ? state.error : null,
    loading: value === undefined && !(fresh && state.error),
  };
}
