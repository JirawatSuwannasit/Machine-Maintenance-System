"use client";

// Shared print stylesheet for every printable report page in this app.
// Both app/machines/[id]/report/page.tsx (MMS-018) and app/reports/page.tsx
// (MMS-019) wrap their printable content in a <div id="printable-report">
// and are meant to render this component once. Extracted here so the print
// approach lives in one place instead of copy-pasted <style jsx global>
// blocks drifting apart.
//
// MMS-018's page still carries its own inline copy of these exact rules --
// app/machines is out of scope to edit in MMS-019 -- but a future ticket
// can safely swap it to render this component instead, since the CSS is
// byte-for-byte the same. Page-specific print rules (e.g. this ticket's
// chart-sizing overrides) stay local to the page that needs them rather
// than being folded in here.
export default function PrintReportStyles() {
  return (
    // eslint-disable-next-line react/no-unknown-property
    <style jsx global>{`
      @media print {
        body * {
          visibility: hidden;
        }
        #printable-report,
        #printable-report * {
          visibility: visible;
        }
        #printable-report {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          margin: 0;
        }
        @page {
          size: A4 portrait;
          margin: 15mm;
        }
        /* !important is required here: <body> carries the app-wide
           bg-surface/text-primary Tailwind classes (from app/layout.tsx),
           and a class selector always outranks a plain element selector
           regardless of source order. */
        body {
          background: #fff !important;
          color: #000 !important;
          font-size: 12px;
        }
        thead {
          display: table-header-group;
        }
        tr {
          break-inside: avoid;
        }
        h2 {
          break-after: avoid;
        }
        .report-badge {
          border: 1px solid #000 !important;
          color: #000 !important;
          background: transparent !important;
        }
      }
    `}</style>
  );
}
