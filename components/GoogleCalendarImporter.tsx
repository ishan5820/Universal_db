"use client";

import { useMemo, useState } from "react";
import { unzipSync, strFromU8 } from "fflate";
import { AlertTriangle, CalendarArrowDown, CheckCircle2, FileArchive, LoaderCircle, X } from "lucide-react";
import { CATEGORY_ORDER, CATEGORY_STYLES } from "@/lib/categories";
import { bulkCreateTasks, getAllTasks, type TaskDraft } from "@/lib/localTasks";
import { parseIcsInBrowser, type CalendarImportRow } from "@/lib/parseIcsBrowser";
import type { TaskCategory } from "@/types/task";

interface GoogleCalendarImporterProps {
  open: boolean;
  onClose: () => void;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_COMBINED_EVENTS = 7_500;

function validateZipSize(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let total = 0;
  let entries = 0;
  for (let offset = 0; offset + 46 <= bytes.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const uncompressed = view.getUint32(offset + 24, true);
    if (uncompressed === 0xffffffff) throw new Error("ZIP64 calendar exports are not supported.");
    total += uncompressed;
    entries += 1;
    if (total > MAX_UNCOMPRESSED_BYTES) throw new Error("The calendars inside this ZIP are larger than the 50 MB safety limit.");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 45 + nameLength + extraLength + commentLength;
  }
  if (!entries) throw new Error("This file is not a readable ZIP export.");
}

function fileLabel(path: string): string {
  return path.split("/").at(-1)?.replace(/\.ics$/i, "") || "Google Calendar";
}

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

export function GoogleCalendarImporter({ open, onClose }: GoogleCalendarImporterProps) {
  const [rows, setRows] = useState<CalendarImportRow[]>([]);
  const [category, setCategory] = useState<TaskCategory>("social");
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; failed: number } | null>(null);
  const selectedCount = useMemo(() => rows.filter((row) => row.include && !row.duplicate).length, [rows]);
  const duplicateCount = useMemo(() => rows.filter((row) => row.duplicate).length, [rows]);

  if (!open) return null;

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(null); setResult(null); setRows([]); setSkipped(0); setTruncated(false); setSourceName(file.name);
    try {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error("Choose a Google export smaller than 25 MB.");
      const calendarFiles: Array<{ name: string; text: string }> = [];
      if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
        const zipBytes = new Uint8Array(await file.arrayBuffer());
        validateZipSize(zipBytes);
        const entries = unzipSync(zipBytes);
        const icsEntries = Object.entries(entries).filter(([name]) => /\.ics$/i.test(name));
        if (!icsEntries.length) throw new Error("This ZIP does not contain any .ics calendar files.");
        const totalSize = icsEntries.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0);
        if (totalSize > MAX_UNCOMPRESSED_BYTES) throw new Error("The calendars inside this ZIP are larger than the 50 MB safety limit.");
        for (const [name, bytes] of icsEntries) calendarFiles.push({ name: fileLabel(name), text: strFromU8(bytes) });
      } else if (/\.ics$/i.test(file.name) || file.type === "text/calendar") {
        calendarFiles.push({ name: fileLabel(file.name), text: await file.text() });
      } else {
        throw new Error("Choose a Google Calendar .zip or .ics export.");
      }

      const existing = await getAllTasks();
      if (!existing.ok) throw new Error(existing.error);
      const knownUids = new Set(existing.tasks.flatMap((task) => task.canvas_uid ? [task.canvas_uid] : []));
      const seenUids = new Set<string>();
      const nextRows: CalendarImportRow[] = [];
      let skippedTotal = 0;
      let wasTruncated = false;
      for (const calendarFile of calendarFiles) {
        const parsed = parseIcsInBrowser(calendarFile.text, calendarFile.name);
        skippedTotal += parsed.skipped;
        wasTruncated ||= parsed.truncated;
        for (const event of parsed.events) {
          if (nextRows.length >= MAX_COMBINED_EVENTS) {
            wasTruncated = true;
            break;
          }
          if (seenUids.has(event.uid)) continue;
          seenUids.add(event.uid);
          const duplicate = knownUids.has(event.uid);
          nextRows.push({ ...event, key: crypto.randomUUID(), category, include: !duplicate, duplicate });
        }
      }
      if (!nextRows.length) throw new Error("No importable calendar events were found.");
      setSkipped(skippedTotal); setTruncated(wasTruncated); setRows(nextRows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read this Google Calendar export.");
    } finally {
      setBusy(false);
    }
  };

  const changeCategory = (nextCategory: TaskCategory) => {
    setCategory(nextCategory);
    setRows((current) => current.map((row) => ({ ...row, category: nextCategory })));
  };

  const importSelected = async () => {
    const selected = rows.filter((row) => row.include && !row.duplicate);
    if (!selected.length) return;
    setBusy(true); setError(null); setResult(null);
    let imported = 0;
    let failed = 0;
    for (const group of chunks(selected, 400)) {
      const drafts: TaskDraft[] = group.map((row) => ({
        canvas_uid: row.uid,
        title: row.title,
        description: row.description,
        due_date: row.dueDate,
        due_time: row.dueTime,
        location: row.location,
        category: row.category,
        course_code: null,
        is_pinned: false,
        is_completed: false,
        source: "ical",
        kind: "event",
        color_shade: 3,
        end_time: row.endTime,
        series_id: row.recurrenceRule ? `google-series:${row.uid.split("::")[0]}` : null,
        recurrence_rule: row.recurrenceRule,
        series_until: null,
        import_batch_id: null,
      }));
      const saved = await bulkCreateTasks(drafts);
      if (saved.ok) imported += saved.count ?? group.length;
      else failed += group.length;
    }
    setBusy(false);
    setResult({ imported, failed });
    if (imported) setRows((current) => current.filter((row) => !row.include || row.duplicate));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="google-import-title" className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 sm:px-7">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">Private calendar import</p><h2 id="google-import-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Move in from Google Calendar</h2><p className="mt-1 text-sm text-slate-500">Choose Google’s ZIP export or an individual ICS file. Processing stays in this browser.</p></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close calendar importer" className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
          <section className="grid gap-4 rounded-3xl border border-dashed border-indigo-200 bg-indigo-50/60 p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm"><FileArchive className="h-6 w-6" /></span>
            <div><p className="font-bold text-indigo-950">Google Calendar → Settings → Import & export → Export</p><p className="mt-1 text-xs leading-5 text-indigo-700">You can select the downloaded ZIP directly. Individual calendar ICS files work too.</p></div>
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm"><input type="file" accept=".zip,.ics,application/zip,text/calendar" onChange={(event) => void loadFile(event.target.files?.[0])} className="sr-only" />{busy && !rows.length ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarArrowDown className="h-4 w-4" />}{busy && !rows.length ? "Reading…" : "Choose export"}</label>
          </section>

          {sourceName && <p className="mt-3 text-xs font-semibold text-slate-500">Selected: {sourceName}</p>}
          {error && <p role="alert" className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}
          {result && <div className={`mt-4 flex items-start gap-3 rounded-2xl p-4 ${result.failed ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><p className="text-sm font-bold">Imported {result.imported} events to this device.{result.failed ? ` ${result.failed} could not be imported.` : ""}</p></div>}

          {rows.length > 0 && <>
            <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-slate-950 p-4 text-white sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold">{rows.length.toLocaleString()} events found</p><p className="mt-1 text-xs text-slate-300">{selectedCount.toLocaleString()} ready · {duplicateCount.toLocaleString()} already imported · {skipped.toLocaleString()} skipped</p></div><label className="text-xs font-bold text-slate-200">Destination<select value={category} onChange={(event) => changeCategory(event.target.value as TaskCategory)} className="ml-2 rounded-lg border border-white/20 bg-white px-3 py-2 text-sm font-bold text-slate-900">{CATEGORY_ORDER.map((item) => <option key={item} value={item}>{CATEGORY_STYLES[item].label}</option>)}</select></label></div>
            {truncated && <div className="mt-3 flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />The safety limit was reached. Import this batch first, then use a smaller calendar export for anything missing.</div>}
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">{rows.slice(0, 500).map((row) => <label key={row.key} className={`flex items-start gap-3 px-4 py-3 ${row.duplicate ? "bg-slate-50 opacity-65" : "bg-white"}`}><input type="checkbox" disabled={row.duplicate} checked={row.include && !row.duplicate} onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, include: event.target.checked } : item))} className="mt-1 h-4 w-4 accent-indigo-600" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-900">{row.title}</span><span className="mt-0.5 block text-xs text-slate-500">{row.dueDate}{row.dueTime ? ` · ${row.dueTime}` : " · all day"}{row.sourceName ? ` · ${row.sourceName}` : ""}</span></span>{row.duplicate && <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600">Already here</span>}</label>)}</div>
              {rows.length > 500 && <p className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">Showing the first 500 for review. All {selectedCount.toLocaleString()} selected events will be imported.</p>}
            </div>
          </>}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 sm:px-7"><button type="button" onClick={onClose} disabled={busy} className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100">{result ? "Done" : "Cancel"}</button><button type="button" onClick={() => void importSelected()} disabled={busy || selectedCount === 0} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-45">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{busy ? "Importing…" : `Import ${selectedCount.toLocaleString()} events`}</button></footer>
      </div>
    </div>
  );
}
