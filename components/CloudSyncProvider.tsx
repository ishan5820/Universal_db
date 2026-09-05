"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { synchronizeCloudCalendar } from "@/lib/cloudSync";
import { loadCloudCheckpoint, saveCloudCheckpoint } from "@/lib/cloudCheckpoint";
import { getAllTasks, replaceTasksFromCloud, subscribeTaskChanges } from "@/lib/localTasks";
import { CALENDAR_VIEW_CHANGE_EVENT, CATEGORY_COLORS_CHANGE_EVENT, WORKSPACE_VIEW_CHANGE_EVENT } from "@/lib/preferences";

export type CloudSyncStatus = "local" | "pending" | "syncing" | "synced" | "offline" | "error" | "account_mismatch";

interface CloudSyncContextValue {
  status: CloudSyncStatus;
  error: string | null;
  lastSyncedAt: string | null;
  syncNow: () => Promise<void>;
}

const CloudSyncContext = createContext<CloudSyncContextValue | null>(null);
const LOCAL_OWNER_KEY = "universal-dashboard-cloud-owner-v1";
const SYNC_INTERVAL_MS = 3 * 60 * 60 * 1_000;
const FUTURE_JWT_RETRY_DELAY_MS = 2_500;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFutureJwtError(error: unknown): boolean {
  return /jwt issued at future/i.test(errorMessage(error));
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user } = useAuth();
  const userId = user?.id ?? null;
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<CloudSyncStatus>("local");
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const running = useRef(false);
  const pending = useRef(false);
  const applyingCloudState = useRef(false);
  const localChangesPending = useRef(false);

  const syncNow = useCallback(async () => {
    if (authStatus !== "signed_in" || !userId) {
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
        if (existingOwner && existingOwner !== userId) {
          setStatus("account_mismatch");
          setError("This browser calendar is already linked to a different Google account. Sign back into that account so calendars cannot be mixed.");
          return;
        }
        if (!existingOwner) window.localStorage.setItem(LOCAL_OWNER_KEY, userId);

        do {
          pending.current = false;
          localChangesPending.current = false;
          setStatus("syncing");
          setError(null);
          const local = await getAllTasks();
          if (!local.ok) throw new Error(local.error);
          const savedCheckpoint = await loadCloudCheckpoint(userId);
          const synchronize = () => synchronizeCloudCalendar({
              supabase,
              userId,
              localTasks: local.tasks,
              checkpoint: savedCheckpoint,
            });
          let result: Awaited<ReturnType<typeof synchronize>>;
          try {
            result = await synchronize();
          } catch (firstError) {
            if (!isFutureJwtError(firstError)) throw firstError;
            const { error: refreshError } = await supabase.auth.refreshSession();
            if (refreshError) throw new Error(`Cloud sign-in could not be refreshed: ${refreshError.message}`);
            await new Promise((resolve) => window.setTimeout(resolve, FUTURE_JWT_RETRY_DELAY_MS));
            result = await synchronize();
          }
          applyingCloudState.current = true;
          const saved = await replaceTasksFromCloud(result.tasks);
          applyingCloudState.current = false;
          if (!saved.ok) throw new Error(saved.error);
          await saveCloudCheckpoint(userId, result.checkpoint);
          setLastSyncedAt(result.checkpoint.lastSuccessfulAt);
          setStatus(localChangesPending.current ? "pending" : "synced");
        } while (pending.current);
      };

      if (navigator.locks) {
        await navigator.locks.request("universal-dashboard-cloud-sync", runSyncLoop);
      } else {
        await runSyncLoop();
      }
    } catch (syncError) {
      applyingCloudState.current = false;
      const message = isFutureJwtError(syncError)
        ? "Cloud sign-in timing could not be verified. Check that this device sets its date and time automatically, then try again."
        : syncError instanceof Error ? syncError.message : "Cloud backup could not be completed.";
      setError(message);
      setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    } finally {
      running.current = false;
    }
  }, [authStatus, supabase, userId]);

  useEffect(() => {
    if (authStatus !== "signed_in" || !userId) {
      const resetTimer = window.setTimeout(() => {
        setStatus("local");
        setError(null);
        setLastSyncedAt(null);
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadCloudCheckpoint(userId).then((checkpoint) => {
        if (!cancelled) setLastSyncedAt(checkpoint?.lastSuccessfulAt ?? null);
      });
      void syncNow();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authStatus, syncNow, userId]);

  useEffect(() => {
    if (authStatus !== "signed_in" || !userId) return;
    const markPending = () => {
      if (applyingCloudState.current) return;
      localChangesPending.current = true;
      setError(null);
      setStatus("pending");
    };
    const onOnline = () => void syncNow();
    const unsubscribeTasks = subscribeTaskChanges(markPending);
    window.addEventListener(CATEGORY_COLORS_CHANGE_EVENT, markPending);
    window.addEventListener(CALENDAR_VIEW_CHANGE_EVENT, markPending);
    window.addEventListener(WORKSPACE_VIEW_CHANGE_EVENT, markPending);
    window.addEventListener("online", onOnline);
    const interval = window.setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    return () => {
      unsubscribeTasks();
      window.clearInterval(interval);
      window.removeEventListener(CATEGORY_COLORS_CHANGE_EVENT, markPending);
      window.removeEventListener(CALENDAR_VIEW_CHANGE_EVENT, markPending);
      window.removeEventListener(WORKSPACE_VIEW_CHANGE_EVENT, markPending);
      window.removeEventListener("online", onOnline);
    };
  }, [authStatus, syncNow, userId]);

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
