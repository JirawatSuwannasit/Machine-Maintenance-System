"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { fetchPartsReplacementTimeline } from "@/lib/fetchPartsReplacementTimeline";
import {
  buildTimelineRows, localCalendarDate, systemYears, timelineRecommendation, timelineYears,
  TIMELINE_WINDOW_YEARS, type TimelineLink, type TimelineReplacement,
} from "@/lib/partsReplacementTimeline";
import { formatDateThai } from "@/lib/pmDueDate";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; links: TimelineLink[]; replacements: TimelineReplacement[] };

function money(value: number | string): string {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const controlClass = "flex min-h-[44px] items-center justify-center gap-1 rounded-md border border-primary/20 px-3 text-sm font-medium text-primary hover:bg-surface focus-visible:outline-accent";

export default function PartsReplacementTimeline({ machineId, installDate }: {
  machineId: string;
  installDate: string | null;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [startYear, setStartYear] = useState(() => new Date().getFullYear() - 9);
  const [selection, setSelection] = useState<{ partId: string; year: number } | null>(null);
  const detailsId = useId();
  const today = localCalendarDate(new Date());
  const years = timelineYears(startYear);
  const rows = useMemo(() => state.status === "loaded"
    ? buildTimelineRows(state.links, state.replacements, today) : [], [state, today]);
  const selectedRow = rows.find((row) => row.partId === selection?.partId);
  const selectedEntries = selection ? selectedRow?.byYear.get(selection.year) ?? [] : [];

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    setSelection(null);
    fetchPartsReplacementTimeline(machineId, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setState({ status: "loaded", ...data }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error" }); });
    return () => controller.abort();
  }, [machineId, retry]);

  function moveWindow(change: number) {
    setStartYear((year) => year + change);
    setSelection(null);
  }

  if (state.status === "loading") return (
    <div role="status" className="space-y-3 py-4 text-sm text-primary/60">
      <p>กำลังโหลดตารางเปลี่ยนอะไหล่...</p>
      <div className="h-40 animate-pulse rounded-lg bg-primary/5" />
    </div>
  );
  if (state.status === "error") return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p>ไม่สามารถโหลดตารางเปลี่ยนอะไหล่ได้ กรุณาลองใหม่อีกครั้ง</p>
      <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 min-h-[44px] rounded-md border border-red-300 px-4 font-medium">ลองใหม่</button>
    </div>
  );

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-primary">ตารางเปลี่ยนอะไหล่</h2>
        <p className="mt-1 text-sm leading-6 text-primary/60">ประวัติการเปลี่ยนจริงแยกตามปีปฏิทิน แตะวงกลมเพื่อดูรายละเอียด</p>
      </div>
      {!installDate && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">ยังไม่ได้ระบุวันที่ติดตั้งเครื่องจักร จึงไม่สามารถแสดงอายุเครื่องในแถว System Years ได้</p>}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-primary/10 bg-surface p-6 text-center text-sm text-primary/60">เครื่องนี้ยังไม่มีอะไหล่ที่ผูกไว้หรือประวัติการเปลี่ยนอะไหล่</p>
      ) : <>
        <div className="flex flex-wrap items-center justify-between gap-2" aria-label="เลือกช่วงปี">
          <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => moveWindow(-TIMELINE_WINDOW_YEARS)} className={controlClass} aria-label="ช่วงปีก่อนหน้า"><ChevronLeft size={16} aria-hidden="true" />ก่อนหน้า</button>
          <span aria-live="polite" className="text-sm font-semibold tabular-nums">{startYear}–{startYear + TIMELINE_WINDOW_YEARS - 1}</span>
          <button type="button" onClick={() => moveWindow(TIMELINE_WINDOW_YEARS)} className={controlClass} aria-label="ช่วงปีถัดไป">ถัดไป<ChevronRight size={16} aria-hidden="true" /></button>
          </div>
          <button type="button" onClick={() => { setStartYear(new Date().getFullYear() - 9); setSelection(null); }} className="min-h-[44px] px-2 text-sm font-medium text-accent">กลับช่วงปีปัจจุบัน</button>
        </div>
        <div role="region" aria-label="ตารางประวัติการเปลี่ยนอะไหล่" tabIndex={0} className="max-h-[70vh] w-full max-w-full overflow-auto rounded-lg border border-primary/15 focus-visible:outline-accent">
          <table className="w-full min-w-[1040px] table-fixed border-separate border-spacing-0 text-sm">
            <caption className="sr-only">ตารางเปลี่ยนอะไหล่ ปี {startYear} ถึง {startYear + TIMELINE_WINDOW_YEARS - 1} อายุเครื่อง ณ วันที่ 31 ธันวาคมของแต่ละปี</caption>
            <colgroup><col className="w-40" />{years.map((year) => <col key={year} className="w-16" />)}<col className="w-44" /></colgroup>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 top-0 z-30 border-b border-r border-primary/15 bg-slate-100 px-3 py-3 text-left">อะไหล่</th>
                {years.map((year) => <th key={year} scope="col" className="sticky top-0 z-20 border-b border-r border-primary/15 bg-slate-100 py-3 text-center font-semibold tabular-nums">{year}</th>)}
                <th scope="col" className="sticky top-0 z-20 border-b border-primary/15 bg-slate-100 px-3 py-3 text-left">คำแนะนำ</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="sticky left-0 z-10 border-b border-r border-primary/15 bg-blue-50 p-3 text-left text-xs font-semibold">System Years<span className="mt-1 block font-normal text-primary/60">อายุเครื่อง ณ สิ้นปี</span></th>
                {years.map((year) => <td key={year} className="border-b border-r border-primary/15 bg-blue-50 p-2 text-center tabular-nums">{systemYears(installDate, year) ?? "-"}</td>)}
                <td className="border-b border-primary/15 bg-blue-50 px-3 text-xs text-primary/60">นับจากวันที่ติดตั้ง</td>
              </tr>
              {rows.map((row, index) => {
                const background = index % 2 ? "bg-slate-50" : "bg-white";
                const recommendation = timelineRecommendation(row);
                return <tr key={row.partId}>
                  <th scope="row" className={`sticky left-0 z-10 border-b border-r border-primary/15 p-3 text-left ${background}`}>
                    <span className="block break-words font-semibold">{row.part?.part_code ?? "-"}</span>
                    <span className="mt-0.5 block break-words text-xs font-normal leading-5 text-primary/70">{row.part?.part_name ?? "ไม่พบข้อมูลอะไหล่"}</span>
                    {row.part?.stock_tracking_enabled === false && <span className="mt-1 block text-xs font-normal text-primary/50">ไม่สต๊อก</span>}
                  </th>
                  {years.map((year) => {
                    const entries = row.byYear.get(year) ?? [];
                    const expanded = selection?.partId === row.partId && selection.year === year;
                    return <td key={year} className={`border-b border-r border-primary/15 p-1 text-center ${background}`}>
                      {entries.length > 0 && <button type="button"
                        onClick={() => setSelection(expanded ? null : { partId: row.partId, year })}
                        aria-label={`${row.part?.part_code ?? row.part?.part_name ?? "อะไหล่"} ปี ${year}: ${entries.length} รายการ`}
                        aria-expanded={expanded} aria-controls={detailsId}
                        className={`inline-flex min-h-[44px] min-w-[44px] flex-col items-center justify-center rounded-md text-accent hover:bg-blue-50 focus-visible:outline-accent ${expanded ? "bg-blue-100 ring-1 ring-accent" : ""}`}>
                        <span aria-hidden="true" className="text-2xl leading-6">○</span>
                        {entries.length > 1 && <span aria-hidden="true" className="text-[10px] leading-4">{entries.length}</span>}
                      </button>}
                    </td>;
                  })}
                  <td className={`border-b border-primary/15 p-3 ${background}`}>
                    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${recommendation.className}`}>{recommendation.label}</span>
                    {row.link?.next_due_date && !row.link.schedule_disabled && (row.link.lifespan_override_days ?? row.part?.default_lifespan_days) != null && <span className="mt-1 block text-xs text-primary/60">ครบกำหนด {formatDateThai(row.link.next_due_date)}</span>}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-5 text-primary/60">○ มีการเปลี่ยนอะไหล่จริง · ตัวเลขใต้เครื่องหมายคือจำนวนรายการ · แสดงประวัติถึงวันนี้เท่านั้น · คำแนะนำอ้างอิงรอบปัจจุบัน ไม่ขึ้นกับช่วงปีที่เลือก</p>
        {!rows.some((row) => row.byYear.size > 0) && <p className="rounded-md bg-surface p-3 text-sm text-primary/60">ยังไม่มีประวัติการเปลี่ยนอะไหล่ที่เกิดขึ้นแล้ว</p>}
        <section id={detailsId} aria-label="รายละเอียดการเปลี่ยนอะไหล่" className={selection && selectedEntries.length ? "rounded-lg border border-accent/20 bg-blue-50/40 p-3 sm:p-4" : "hidden"}>
          {selection && selectedRow && <>
            <div className="flex items-start justify-between gap-2">
              <h3 className="min-w-0 break-words text-sm font-semibold">{selectedRow.part?.part_code ?? "-"} — {selectedRow.part?.part_name ?? "ไม่พบข้อมูลอะไหล่"}<span className="mt-1 block font-normal text-primary/60">ปี {selection.year} · {selectedEntries.length} รายการ</span></h3>
              <button type="button" onClick={() => setSelection(null)} aria-label="ปิดรายละเอียด" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-blue-100"><X size={18} aria-hidden="true" /></button>
            </div>
            <ol className="mt-3 max-h-96 space-y-2 overflow-y-auto">
              {selectedEntries.map((entry) => <li key={entry.id} className="rounded-md border border-primary/10 bg-white p-3 text-sm">
                <p className="font-medium">{formatDateThai(entry.replaced_at)}</p>
                <dl className="mt-2 grid gap-2 text-xs text-primary/70 sm:grid-cols-2">
                  <div><dt className="inline">จำนวน: </dt><dd className="inline">{entry.qty_used.toLocaleString("en-US")}</dd></div>
                  <div className="break-words"><dt className="inline">ผู้เปลี่ยน: </dt><dd className="inline">{entry.replaced_by || "-"}</dd></div>
                  <div><dt className="inline">เหตุผล: </dt><dd className="inline">{entry.reason === "planned" ? "ตามรอบ" : entry.reason === "breakdown" ? "เครื่องเสีย" : "ไม่ระบุ"}</dd></div>
                  <div><dt className="inline">ราคาต่อหน่วย: </dt><dd className="inline">{money(entry.unit_cost)} บาท</dd></div>
                  <div><dt className="inline">ค่าใช้จ่ายที่บันทึก: </dt><dd className="inline">{money(entry.total_cost)} บาท</dd></div>
                </dl>
              </li>)}
            </ol>
          </>}
        </section>
      </>}
    </div>
  );
}
