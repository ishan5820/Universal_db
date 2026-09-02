"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarArrowDown, CalendarDays, CalendarPlus, Download, GraduationCap, HardDrive, Heart, LayoutDashboard, RefreshCw, Settings2, Trophy, Users, X } from "lucide-react";
import { getAllTasks } from "@/lib/localTasks";
import { CATEGORY_STYLES } from "@/lib/categories";
import { RecurringEventModal } from "@/components/RecurringEventModal";
import { SyncReviewModal } from "@/components/SyncReviewModal";
import { GoogleCalendarImporter } from "@/components/GoogleCalendarImporter";

const items = [
  { href: "/", label: "Overview", icon: LayoutDashboard, dot: null },
  { href: "/classes", label: "Classes", icon: GraduationCap, dot: CATEGORY_STYLES.classes.dot },
  { href: "/orgs", label: "Orgs", icon: Users, dot: CATEGORY_STYLES.orgs.dot },
  { href: "/social", label: "Social", icon: Heart, dot: CATEGORY_STYLES.social.dot },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const [syncOpen, setSyncOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [calendarImportOpen, setCalendarImportOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportData = async () => {
    setExportBusy(true); setExportError(null);
    const result = await getAllTasks();
    setExportBusy(false);
    if (!result.ok) { setExportError(result.error); return; }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([JSON.stringify(result.tasks, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `universal-dashboard-${timestamp}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-5 md:flex">
        <Link href="/" className="flex items-center gap-3 rounded-2xl px-2 py-2" aria-label="Universal Dashboard home">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm"><CalendarDays className="h-5 w-5" /></span>
          <span><span className="block text-sm font-bold tracking-tight text-slate-950">Universal Dashboard</span><span className="block text-xs text-slate-500">Your calendar, your device</span></span>
        </Link>
        <nav className="mt-8 space-y-1" aria-label="Primary navigation">
          {items.map(({ href, label, icon: Icon, dot }) => {
            const active = href === "/" ? pathname === "/" : href === "/social" ? pathname === "/social" : pathname.startsWith(href);
            return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}><Icon className="h-[18px] w-[18px]" /><span className="flex-1">{label}</span>{dot && <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />}</Link>;
          })}
          <Link href="/social/sports" aria-current={pathname === "/social/sports" ? "page" : undefined} className={`ml-5 flex items-center gap-2.5 rounded-xl border-l-2 px-3 py-2 text-xs font-bold transition ${pathname === "/social/sports" ? "border-indigo-500 bg-indigo-50 text-indigo-950" : "border-slate-200 text-slate-500 hover:border-indigo-300 hover:bg-slate-100 hover:text-slate-900"}`}><Trophy className="h-4 w-4" />Sporting Events</Link>
        </nav>
        <div className="mt-auto space-y-3 rounded-2xl bg-slate-50 p-3">
          <div className="flex items-center gap-2 px-1 text-[11px] font-semibold text-slate-500"><HardDrive className="h-3.5 w-3.5 text-emerald-600" />Saved privately on this device</div>
          <button type="button" onClick={() => setRecurringOpen(true)} className="flex w-full items-center gap-3 rounded-xl bg-slate-950 px-3 py-3 text-left text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10"><CalendarPlus className="h-4 w-4" /></span><span><span className="block">Add recurring</span><span className="block text-xs font-normal text-slate-300">Build a semester routine</span></span></button>
          <button type="button" onClick={() => void exportData()} disabled={exportBusy} className="w-full rounded-xl bg-white px-3 py-2.5 text-center text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 disabled:opacity-50"><Download className="mr-2 inline h-4 w-4 text-indigo-600" />{exportBusy ? "Exporting…" : "Export data"}</button>
          <button type="button" onClick={() => setCalendarImportOpen(true)} className="w-full rounded-xl bg-white px-3 py-2.5 text-center text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200"><CalendarArrowDown className="mr-2 inline h-4 w-4 text-indigo-600" />Import Google Calendar</button>
          {exportError && <p role="alert" className="rounded-lg bg-rose-50 px-2 py-1.5 text-xs font-semibold text-rose-700">{exportError}</p>}
          <div>
          <p className="px-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Canvas</p>
          <button type="button" onClick={() => setSyncOpen(true)} className="mt-2 flex w-full items-center gap-3 rounded-xl bg-white px-3 py-3 text-left text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-600"><RefreshCw className="h-4 w-4" /></span><span><span className="block">Sync Canvas</span><span className="block text-xs font-normal text-slate-500">Review before saving</span></span></button>
          </div>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-slate-200 bg-white/95 px-1 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 backdrop-blur md:hidden" aria-label="Mobile navigation">
        {items.map(({ href, label, icon: Icon, dot }) => {
          const active = href === "/" ? pathname === "/" : href === "/social" ? pathname === "/social" : pathname.startsWith(href);
          return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold ${active ? "bg-slate-100 text-slate-950" : "text-slate-500"}`}><span className="relative"><Icon className="h-5 w-5" />{dot && <span className={`absolute -right-1 -top-0.5 h-2 w-2 rounded-full ring-2 ring-white ${dot}`} />}</span>{label}</Link>;
        })}
        <Link href="/social/sports" aria-current={pathname === "/social/sports" ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold ${pathname === "/social/sports" ? "bg-indigo-50 text-indigo-950" : "text-indigo-600"}`}><Trophy className="h-5 w-5" />Sports</Link>
        <button type="button" onClick={() => setToolsOpen(true)} aria-expanded={toolsOpen} className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold text-indigo-700"><Settings2 className="h-5 w-5" />Tools</button>
      </nav>
      {toolsOpen && (
        <div className="fixed inset-0 z-[65] flex items-end bg-slate-950/45 backdrop-blur-[2px] md:hidden" onMouseDown={(event) => { if (event.target === event.currentTarget) setToolsOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="mobile-tools-title" className="w-full rounded-t-3xl bg-white px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-5 shadow-2xl">
            <header className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">Calendar tools</p><h2 id="mobile-tools-title" className="mt-1 text-xl font-bold text-slate-950">Bring in, back up, or add events</h2></div><button type="button" onClick={() => setToolsOpen(false)} aria-label="Close tools" className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></header>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => { setToolsOpen(false); setCalendarImportOpen(true); }} className="flex min-h-24 flex-col items-start justify-between rounded-2xl bg-indigo-50 p-4 text-left font-bold text-indigo-950"><CalendarArrowDown className="h-6 w-6 text-indigo-600" /><span>Import Google Calendar</span></button>
              <button type="button" onClick={() => { setToolsOpen(false); setSyncOpen(true); }} className="flex min-h-24 flex-col items-start justify-between rounded-2xl bg-orange-50 p-4 text-left font-bold text-orange-950"><RefreshCw className="h-6 w-6 text-orange-600" /><span>Sync Canvas</span></button>
              <button type="button" onClick={() => { setToolsOpen(false); setRecurringOpen(true); }} className="flex min-h-24 flex-col items-start justify-between rounded-2xl bg-slate-100 p-4 text-left font-bold text-slate-900"><CalendarPlus className="h-6 w-6 text-slate-700" /><span>Add recurring</span></button>
              <button type="button" onClick={() => { setToolsOpen(false); void exportData(); }} disabled={exportBusy} className="flex min-h-24 flex-col items-start justify-between rounded-2xl bg-emerald-50 p-4 text-left font-bold text-emerald-950 disabled:opacity-50"><Download className="h-6 w-6 text-emerald-600" /><span>{exportBusy ? "Exporting…" : "Export backup"}</span></button>
            </div>
            {exportError && <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{exportError}</p>}
          </section>
        </div>
      )}
      <SyncReviewModal open={syncOpen} onClose={() => setSyncOpen(false)} />
      <GoogleCalendarImporter open={calendarImportOpen} onClose={() => setCalendarImportOpen(false)} />
      {recurringOpen && <RecurringEventModal open onClose={() => setRecurringOpen(false)} />}
    </>
  );
}
