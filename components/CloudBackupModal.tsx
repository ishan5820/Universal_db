"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Cloud, CloudOff, HardDrive, LoaderCircle, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useCloudSync, type CloudSyncStatus } from "@/components/CloudSyncProvider";
import { getAllTasks, subscribeTaskChanges } from "@/lib/localTasks";

const STATUS_COPY: Record<CloudSyncStatus, { title: string; detail: string }> = {
  local: { title: "Preparing cloud backup", detail: "Your calendar is still saved on this device while cloud backup starts." },
  syncing: { title: "Backing up now", detail: "Local changes are being safely merged with your private cloud copy." },
  synced: { title: "Cloud backup is current", detail: "Sign in with this Google account on another device to recover this calendar." },
  offline: { title: "Waiting for internet", detail: "Changes remain saved on this device and will retry automatically when you reconnect." },
  error: { title: "Cloud backup needs attention", detail: "Your local calendar is safe. Try the backup again when you are ready." },
  account_mismatch: { title: "Account safety check", detail: "Sync is paused so two different users' calendars cannot be mixed in this browser." },
};

function StatusIcon({ status }: { status: CloudSyncStatus }) {
  if (status === "syncing") return <LoaderCircle className="h-5 w-5 animate-spin" />;
  if (status === "synced") return <Check className="h-5 w-5" />;
  if (status === "offline") return <CloudOff className="h-5 w-5" />;
  if (status === "error" || status === "account_mismatch") return <AlertTriangle className="h-5 w-5" />;
  return <Cloud className="h-5 w-5" />;
}

export function CloudBackupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const cloud = useCloudSync();
  const [itemCount, setItemCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refreshCount = () => {
      void getAllTasks().then((result) => {
        if (!cancelled && result.ok) setItemCount(result.count);
      });
    };
    refreshCount();
    const unsubscribe = subscribeTaskChanges(refreshCount);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [open]);

  if (!open) return null;
  const copy = STATUS_COPY[cloud.status];
  const lastBackup = cloud.lastSyncedAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(cloud.lastSyncedAt))
    : "Not completed yet";

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="cloud-backup-title" className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl sm:p-7">
        <header className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-600">Backup & recovery</p><h2 id="cloud-backup-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Your calendar is protected.</h2></div>
          <button type="button" onClick={onClose} aria-label="Close backup details" className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </header>

        <div className={`mt-6 rounded-2xl border p-4 ${cloud.status === "error" || cloud.status === "account_mismatch" ? "border-rose-200 bg-rose-50 text-rose-950" : cloud.status === "offline" ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}>
          <div className="flex items-start gap-3"><span className="mt-0.5"><StatusIcon status={cloud.status} /></span><div><p className="font-bold">{copy.title}</p><p className="mt-1 text-sm leading-6 opacity-80">{copy.detail}</p></div></div>
          {cloud.error && <p role="alert" className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-xs font-semibold leading-5">{cloud.error}</p>}
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-slate-50 p-4"><dt className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"><HardDrive className="h-4 w-4" />On this device</dt><dd className="mt-2 text-xl font-bold text-slate-950">{itemCount === null ? "—" : itemCount.toLocaleString()}</dd><dd className="text-xs text-slate-500">calendar items</dd></div>
          <div className="rounded-2xl bg-slate-50 p-4"><dt className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"><Cloud className="h-4 w-4" />Last backup</dt><dd className="mt-2 text-sm font-bold leading-5 text-slate-950">{lastBackup}</dd></div>
        </dl>

        <div className="mt-5 rounded-2xl border border-slate-200 p-4">
          <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" /><div><p className="text-sm font-bold text-slate-950">Private to {user?.email ?? "your account"}</p><p className="mt-1 text-xs leading-5 text-slate-500">Database security rules restrict every cloud row to its owner. Clearing browser storage removes the device copy, but signing in again restores the latest completed cloud backup.</p></div></div>
        </div>

        <button type="button" onClick={() => void cloud.syncNow()} disabled={cloud.status === "syncing" || cloud.status === "account_mismatch"} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"><RefreshCw className={`h-4 w-4 ${cloud.status === "syncing" ? "animate-spin" : ""}`} />{cloud.status === "syncing" ? "Backing up…" : "Back up now"}</button>
        <p className="mt-3 text-center text-xs leading-5 text-slate-500">For an extra portable copy, use <strong>Export data</strong>. Its JSON file now includes every category, subtask, color, and saved view.</p>
      </section>
    </div>
  );
}
