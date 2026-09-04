"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { synchronizeCloudCalendar } from "@/lib/cloudSync";
import { loadCloudCheckpoint, saveCloudCheckpoint } from "@/lib/cloudCheckpoint";
import { getAllTasks, replaceTasksFromCloud, subscribeTaskChanges } from "@/lib/localTasks";
import { CALENDAR_VIEW_CHANGE_EVENT, CATEGORY_COLORS_CHANGE_EVENT, WORKSPACE_VIEW_CHANGE_EVENT } from "@/lib/preferences";

export type CloudSyncStatus = "local" | "syncing" | "synced" | "offline" | "error" | "account_mismatch";

interface CloudSyncContextValue {
  status: CloudSyncStatus;
  error: string | null;
  lastSyncedAt: string | null;
  syncNow: () => Promise<void>;
}

const CloudSyncContext = createContext<CloudSyncContextValue | null>(null);
const LOCAL_OWNER_KEY = "universal-dashboard-cloud-owner-v1";
const SYNC_INTERVAL_MS = 30_000;

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<CloudSyncStatus>("local");
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const running = useRef(false);
  const pending = useRef(false);
  const applyingCloudState = useRef(false);

  const syncNow = useCallback(async () => {
    if (authStatus !== "signed_in" || !user) {
      setStatus("local");
      return;
    }
    if (running.current) {
      pending.current = true;
      return;
    }

    running.current = true;
    try {
      const runSyncLoop = async () => {
        const existingOwner = window.localStorage.getItem(LOCAL_OWNER_KEY);
        if (existingOwner && existingOwner !== user.id) {
          setStatus("account_mismatch");
          setError("This browser calendar is already linked to a different Google account. Sign back into that account so calendars cannot be mixed.");
          return;
        }
        if (!existingOwner) window.localStorage.setItem(LOCAL_OWNER_KEY, user.id);

        do {
          pending.current = false;
          setStatus("syncing");
          setError(null);
          const local = await getAllTasks();
          if (!local.ok) throw new Error(local.error);
          const savedCheckpoint = await loadCloudCheckpoint(user.id);
          const result = await synchronizeCloudCalendar({
            supabase,
            userId: user.id,
            localTasks: local.tasks,
            checkpoint: savedCheckpoint,
          });
          applyingCloudState.current = true;
          const saved = await replaceTasksFromCloud(result.tasks);
          applyingCloudState.current = false;
          if (!saved.ok) throw new Error(saved.error);
          await saveCloudCheckpoint(user.id, result.checkpoint);
          setLastSyncedAt(result.checkpoint.lastSuccessfulAt);
          setStatus("synced");
        } while (pending.current);
      };

      if (navigator.locks) {
        await navigator.locks.request("universal-dashboard-cloud-sync", runSyncLoop);
      } else {
        await runSyncLoop();
      }
    } catch (syncError) {
      applyingCloudState.current = false;
      const message = syncError instanceof Error ? syncError.message : "Cloud backup could not be completed.";
      setError(message);
      setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    } finally {
      running.current = false;
    }
  }, [authStatus, supabase, user]);

  useEffect(() => {
    if (authStatus !== "signed_in" || !user) {
      const resetTimer = window.setTimeout(() => {
        setStatus("local");
        setError(null);
        setLastSyncedAt(null);
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadCloudCheckpoint(user.id).then((checkpoint) => {
        if (!cancelled) setLastSyncedAt(checkpoint?.lastSuccessfulAt ?? null);
      });
      void syncNow();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authStatus, syncNow, user]);

  useEffect(() => {
    if (authStatus !== "signed_in" || !user) return;
    let debounceTimer: number | null = null;
    const queueSync = () => {
      if (applyingCloudState.current) return;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => void syncNow(), 700);
    };
    const unsubscribeTasks = subscribeTaskChanges(queueSync);
    window.addEventListener(CATEGORY_COLORS_CHANGE_EVENT, queueSync);
    window.addEventListener(CALENDAR_VIEW_CHANGE_EVENT, queueSync);
    window.addEventListener(WORKSPACE_VIEW_CHANGE_EVENT, queueSync);
    window.addEventListener("online", queueSync);
    const onFocus = () => void syncNow();
    const onVisibility = () => { if (document.visibilityState === "visible") void syncNow(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    return () => {
      unsubscribeTasks();
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      window.clearInterval(interval);
      window.removeEventListener(CATEGORY_COLORS_CHANGE_EVENT, queueSync);
      window.removeEventListener(CALENDAR_VIEW_CHANGE_EVENT, queueSync);
      window.removeEventListener(WORKSPACE_VIEW_CHANGE_EVENT, queueSync);
      window.removeEventListener("online", queueSync);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [authStatus, syncNow, user]);

  const value = useMemo<CloudSyncContextValue>(
    () => ({ status, error, lastSyncedAt, syncNow }),
    [status, error, lastSyncedAt, syncNow],
  );
  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}

export function useCloudSync() {
  const value = useContext(CloudSyncContext);
  if (!value) throw new Error("useCloudSync must be used within CloudSyncProvider");
  return value;
}
