"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  buildTimelineRows, localCalendarDate, reportTimelineYears, systemYears, timelineRecommendation,
  type TimelineLink, type TimelineReplacement,
} from "@/lib/partsReplacementTimeline";
import { formatDateThai } from "@/lib/pmDueDate";

export default function PartsReplacementTimelinePrint({ machine, links, replacements, generatedAt, onOverflowChange }: {
  machine: { machine_code: string; machine_name: string; install_date: string | null };
  links: TimelineLink[];
  replacements: TimelineReplacement[];
  generatedAt: Date;
  onOverflowChange: (overflow: boolean) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const warningRef = useRef<HTMLParagraphElement>(null);
  const [overflow, setOverflow] = useState(false);
  const today = localCalendarDate(generatedAt);
  const years = reportTimelineYears(machine.install_date, generatedAt);
  const rows = useMemo(() => buildTimelineRows(links, replacements, today), [links, replacements, today]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      // A4 landscape (210mm high), with the report's existing 12mm margins.
      // Keep text at 8pt or larger; allow an explicit overflow instead of clipping.
      const height = content.getBoundingClientRect().height - (warningRef.current?.getBoundingClientRect().height ?? 0);
      const tooTall = height > 185 * 96 / 25.4;
      setOverflow(tooTall);
      onOverflowChange(tooTall);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    measure();
    void document.fonts.ready.then(measure);
    return () => { cancelled = true; observer.disconnect(); };
  }, [rows, years.length, machine, generatedAt, onOverflowChange]);

  return (
    <section className={`parts-timeline-print-page ${rows.length > 18 ? "timeline-print-compact" : ""} ${overflow ? "timeline-print-overflow" : ""}`}>
      {/* Page-specific rules: shared portrait reports and interactive tables are untouched. */}
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style jsx global>{`
        .parts-timeline-print-page {
          color: #000;
          font-family: Tahoma, "Noto Sans Thai", sans-serif;
          font-size: 9pt;
          line-height: 1.4;
        }
        .parts-timeline-print-page > div { padding-top: 1mm; }
        .parts-timeline-print-page h2 { font-size: 13pt; line-height: 1.6; font-weight: 700; margin: 0 0 2mm; }
        .parts-timeline-print-page p { margin: 1mm 0 2mm; }
        .parts-timeline-print-page table { border-collapse: collapse; table-layout: fixed; margin-top: 3mm; font-size: inherit; line-height: inherit; }
        .parts-timeline-print-page th, .parts-timeline-print-page td {
          border: 0.2mm solid #666;
          padding: 1mm 1.2mm;
          overflow-wrap: anywhere;
          vertical-align: middle;
        }
        .parts-timeline-print-page thead th { background: #eee; font-weight: 700; }
        .parts-timeline-print-page .timeline-print-age { background: #f2f2f2; font-weight: 600; }
        .parts-timeline-print-page .timeline-print-year { text-align: center; font-variant-numeric: tabular-nums; }
        .parts-timeline-print-page .timeline-print-part { text-align: left; font-weight: 400; }
        .parts-timeline-print-page .timeline-print-marker { font: 12pt/1 Arial, sans-serif; }
        .parts-timeline-print-page .timeline-print-count { font-size: 8pt; margin-left: 1mm; }
        .parts-timeline-print-page .timeline-print-due-date { display: block; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .parts-timeline-print-page .timeline-print-legend { font-size: 8pt; margin-top: 2mm; }
        .timeline-print-compact { font-size: 8pt; line-height: 1.2; }
        .timeline-print-compact th, .timeline-print-compact td { padding: 0.25mm 1mm; }
        @media screen {
          .parts-timeline-print-page { position: fixed; left: -10000px; top: 0; width: 273mm; visibility: hidden; }
        }
        @media print {
          .parts-timeline-print-page { width: 100%; margin: 0; break-before: page; break-inside: avoid-page; }
          .parts-timeline-print-page.timeline-print-overflow { break-inside: auto; }
          .parts-timeline-print-page thead { display: table-header-group; }
          .parts-timeline-print-page tr { break-inside: avoid; }
        }
      `}</style>
      <div ref={contentRef}>
        <h2>ตารางเปลี่ยนอะไหล่ย้อนหลัง 10 ปี</h2>
        <p><strong>{machine.machine_code}</strong> — {machine.machine_name}</p>
        <p>พิมพ์วันที่ {formatDateThai(today)}{years.length > 0 && ` · ช่วงปี ${years[0]}–${years[years.length - 1]}`}</p>
        {!machine.install_date && <p>ไม่ได้ระบุวันที่ติดตั้งเครื่องจักร</p>}
        {years.length === 0 && <p>วันที่ติดตั้งเครื่องจักรอยู่ในอนาคต ยังไม่มีช่วงปีสำหรับรายงาน</p>}
        <p className="timeline-print-legend">○ มีการเปลี่ยนอะไหล่จริง · ตัวเลขคือจำนวนรายการ · คำแนะนำอ้างอิงรอบปัจจุบัน ไม่ขึ้นกับตัวกรองวันที่ของรายงาน</p>
        {overflow && <p ref={warningRef} className="timeline-print-legend" style={{ margin: 0, padding: "1mm 0" }}>ตารางมีข้อมูลเกินหนึ่งหน้ากระดาษ ระบบจะแสดงข้อมูลทั้งหมดในหน้าถัดไป</p>}
        <table aria-label="ตารางประวัติการเปลี่ยนอะไหล่สำหรับรายงานเครื่องจักร" style={{ width: `${78 + years.length * 14 + 55}mm` }}>
          <colgroup><col style={{ width: "78mm" }} />{years.map((year) => <col key={year} style={{ width: "14mm" }} />)}<col style={{ width: "55mm" }} /></colgroup>
          <thead><tr><th scope="col" className="timeline-print-part">อะไหล่</th>{years.map((year) => <th key={year} scope="col" className="timeline-print-year">{year}</th>)}<th scope="col" className="timeline-print-part">คำแนะนำ</th></tr></thead>
          <tbody>
            <tr className="timeline-print-age"><th scope="row" className="timeline-print-part">System Years</th>{years.map((year) => <td key={year} className="timeline-print-year">{systemYears(machine.install_date, year) ?? "-"}</td>)}<td>อายุเครื่อง ณ สิ้นปี</td></tr>
            {rows.map((row) => <tr key={row.partId}>
              <th scope="row" className="timeline-print-part"><strong>{row.part?.part_code ?? "-"}</strong> — {row.part?.part_name ?? "ไม่พบข้อมูลอะไหล่"}</th>
              {years.map((year) => {
                const count = row.byYear.get(year)?.length ?? 0;
                return <td key={year} className="timeline-print-year">{count > 0 && <><span className="timeline-print-marker">○</span>{count > 1 && <span className="timeline-print-count">{count}</span>}</>}</td>;
              })}
              <td>
                {timelineRecommendation(row, generatedAt).label}
                {row.link?.next_due_date && !row.link.schedule_disabled && (row.link.lifespan_override_days ?? row.part?.default_lifespan_days) != null && <span className="timeline-print-due-date">ครบกำหนด {formatDateThai(row.link.next_due_date)}</span>}
              </td>
            </tr>)}
          </tbody>
        </table>
        {rows.length === 0 && <p>เครื่องนี้ยังไม่มีอะไหล่ที่ผูกไว้หรือประวัติการเปลี่ยนอะไหล่</p>}
      </div>
    </section>
  );
}
