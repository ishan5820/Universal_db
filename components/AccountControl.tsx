"use client";

import { useState } from "react";
import { AlertTriangle, Check, Cloud, CloudOff, Info, LoaderCircle, LogIn, LogOut, RefreshCw } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useCloudSync } from "@/components/CloudSyncProvider";
import { CloudBackupModal } from "@/components/CloudBackupModal";

export function AccountControl({ mobile = false }: { mobile?: boolean }) {
  const [backupDetailsOpen, setBackupDetailsOpen] = useState(false);
  const { status, user, error, signInWithGoogle, signOut } = useAuth();
  const cloud = useCloudSync();
  const email = user?.email ?? "Google account";
  const initial = email.slice(0, 1).toUpperCase();

  if (status === "loading") {
    return (
      <div className={`flex items-center gap-2 text-xs font-semibold text-slate-500 ${mobile ? "rounded-2xl bg-slate-50 p-4" : "px-1"}`}>
        <LoaderCircle className="h-4 w-4 animate-spin" /> Checking sign-in…
      </div>
    );
  }

  if (status === "signed_in") {
    const cloudLabel = cloud.status === "syncing"
      ? "Backing up…"
      : cloud.status === "synced"
        ? "Backed up across devices"
        : cloud.status === "offline"
          ? "Saved locally · waiting for internet"
          : cloud.status === "account_mismatch"
            ? "Account safety check"
            : cloud.status === "error"
              ? "Cloud backup needs attention"
              : "Preparing cloud backup";
    const CloudStatusIcon = cloud.status === "syncing"
      ? LoaderCircle
      : cloud.status === "synced"
        ? Check
        : cloud.status === "offline"
          ? CloudOff
          : cloud.status === "error" || cloud.status === "account_mismatch"
            ? AlertTriangle
            : Cloud;
    return (
      <>
      <div className={`rounded-2xl border border-emerald-100 bg-emerald-50/70 ${mobile ? "p-4" : "p-3"}`}>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white">{initial}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">Signed in</span>
            <span className="block truncate text-xs font-semibold text-slate-800" title={email}>{email}</span>
          </span>
          <button type="button" onClick={() => void signOut()} aria-label="Sign out" title="Sign out" className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-900">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold leading-4 text-slate-600">
          <CloudStatusIcon className={`h-3.5 w-3.5 ${cloud.status === "syncing" ? "animate-spin" : ""}`} />{cloudLabel}
        </div>
        {(cloud.status === "error" || cloud.status === "offline") && <button type="button" onClick={() => void cloud.syncNow()} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200"><RefreshCw className="h-3 w-3" />Try again</button>}
        <button type="button" onClick={() => setBackupDetailsOpen(true)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"><Info className="h-3 w-3" />Backup details</button>
        {cloud.error && <p role="alert" className="mt-2 text-[11px] leading-4 text-rose-700">{cloud.error}</p>}
        {error && <p role="alert" className="mt-2 text-[11px] font-semibold text-rose-700">{error}</p>}
      </div>
      <CloudBackupModal open={backupDetailsOpen} onClose={() => setBackupDetailsOpen(false)} />
      </>
    );
  }

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white ${mobile ? "p-4" : "p-3"}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Cloud className="h-4 w-4" /></span>
        <span>
          <span className="block text-xs font-bold text-slate-900">Use it across devices</span>
          <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">Sign in to back up and use your calendar across devices.</span>
        </span>
      </div>
      <button type="button" onClick={() => void signInWithGoogle()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-bold text-white hover:bg-slate-800">
        <LogIn className="h-4 w-4" /> Sign in with Google
      </button>
      {error && <p role="alert" className="mt-2 text-[11px] font-semibold text-rose-700">{error}</p>}
    </div>
  );
}
