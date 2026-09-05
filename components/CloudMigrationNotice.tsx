"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Cloud, CloudOff, LoaderCircle, LogIn, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useCloudSync } from "@/components/CloudSyncProvider";

const DISMISS_KEY = "universal-dashboard-cloud-migration-confirmed-v1";

export function CloudMigrationNotice({ itemCount }: { itemCount: number }) {
  const { status: authStatus, signInWithGoogle } = useAuth();
  const cloud = useCloudSync();
  const [successDismissed, setSuccessDismissed] = useState<boolean | null>(null);
  const itemNoun = itemCount === 1 ? "item" : "items";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSuccessDismissed(window.localStorage.getItem(DISMISS_KEY) === "true");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (itemCount === 0 || authStatus === "loading") return null;

  if (authStatus === "signed_out") {
    return (
      <section aria-labelledby="protect-calendar-title" className="mb-5 rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white"><Cloud className="h-5 w-5" /></span>
            <div><h2 id="protect-calendar-title" className="font-bold text-indigo-950">Protect the {itemCount.toLocaleString()} {itemNoun} already on this device</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-indigo-800">Sign in on this browser before clearing site data or moving devices. Your first successful backup will copy this existing calendar into your private account without deleting the device copy.</p></div>
          </div>
          <button type="button" onClick={() => void signInWithGoogle()} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"><LogIn className="h-4 w-4" />Sign in with Google</button>
        </div>
      </section>
    );
  }

  if (cloud.status === "synced") {
    if (successDismissed !== false) return null;
    return (
      <section aria-live="polite" className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-sm">
        <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"><Check className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h2 className="font-bold text-emerald-950">Your existing calendar is backed up</h2><p className="mt-1 text-sm leading-6 text-emerald-800">All {itemCount.toLocaleString()} {itemNoun} currently on this device {itemCount === 1 ? "has" : "have"} completed the first account backup. You can now recover {itemCount === 1 ? "it" : "them"} by signing into the same Google account on another device.</p></div><button type="button" onClick={() => { window.localStorage.setItem(DISMISS_KEY, "true"); setSuccessDismissed(true); }} aria-label="Dismiss backup confirmation" className="rounded-full p-2 text-emerald-700 hover:bg-emerald-100"><X className="h-4 w-4" /></button></div>
      </section>
    );
  }

  if (cloud.status === "pending" && cloud.lastSyncedAt) return null;

  if (cloud.status === "offline" || cloud.status === "error" || cloud.status === "account_mismatch") {
    const accountMismatch = cloud.status === "account_mismatch";
    return (
      <section role="alert" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3"><span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">{cloud.status === "offline" ? <CloudOff className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}</span><div><h2 className="font-bold text-amber-950">{accountMismatch ? "Sign back into this calendar’s original account" : "Your device copy is safe, but cloud backup is waiting"}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-amber-800">{accountMismatch ? "Backup is paused so two accounts cannot be mixed in one browser." : "Do not clear this browser’s site data yet. Reconnect and finish one successful backup first."}</p></div></div>
          {!accountMismatch && <button type="button" onClick={() => void cloud.syncNow()} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-700"><RefreshCw className="h-4 w-4" />Try backup again</button>}
        </div>
      </section>
    );
  }

  return (
    <section aria-live="polite" className="mb-5 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 shadow-sm">
      <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white"><LoaderCircle className="h-5 w-5 animate-spin" /></span><div><h2 className="font-bold text-sky-950">Backing up your existing calendar…</h2><p className="mt-1 text-sm leading-6 text-sky-800">Keep this page open until the backup confirmation appears. Your {itemCount.toLocaleString()} local {itemNoun} {itemCount === 1 ? "remains" : "remain"} usable while this finishes.</p></div></div>
    </section>
  );
}
