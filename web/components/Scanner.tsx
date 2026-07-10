"use client";

import { type ChangeEvent, type DragEvent, type ReactNode, useMemo, useRef, useState } from "react";

import { type AuditItem, auditOf, type Entity, tokenizeText } from "@/lib/gateway";

// Flavour for the tiles + the shareable card. Labels come from lib/gateway.
const CATEGORY_ICON: Record<string, string> = {
  ch_ahv: "🇨🇭",
  iban: "🏦",
  credit_card: "💳",
  ch_phone: "☎️",
  email: "✉️",
  dob: "🎂",
  name: "🪪",
  address: "📍",
};

const MAX_BYTES = 8_000_000;

type Audit = { items: AuditItem[]; total: number };

const SAMPLES: { id: string; label: string; text: string }[] = [
  {
    id: "email",
    label: "Support email",
    text:
      "Subject: Refund request\n\n" +
      "Hi — please refund CHF 240 to my account IBAN CH93 0076 2011 6238 5295 7.\n" +
      "My AHV is 756.1234.5678.97 and you can reach me on +41 79 214 88 03 or\n" +
      "hans.muster@bluewin.ch. Thanks, Hans",
  },
  {
    id: "csv",
    label: "CSV export",
    text:
      "id,name,ahv,iban,card\n" +
      "1,H. Muster,756.1234.5678.97,CH9300762011623852957,4111 1111 1111 1111\n" +
      "2,A. Meier,756.9217.0769.85,CH5604835012345678009,5500 0000 0000 0004\n",
  },
  {
    id: "clean",
    label: "Clean text",
    text:
      "Our opening hours are Monday to Friday, 9:00–17:00. For general questions " +
      "write to the team and we'll get back to you within two business days.",
  },
];

// Raw text with the detected PII spans marked red (stays in the browser).
function highlight(text: string, spans: { start: number; end: number }[]): ReactNode {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const s of sorted) {
    if (s.start > cursor) out.push(text.slice(cursor, s.start));
    out.push(
      <mark className="pii" key={s.start}>
        {text.slice(s.start, s.end)}
      </mark>,
    );
    cursor = s.end;
  }
  out.push(text.slice(cursor));
  return out;
}

// Sanitized text with the placeholders marked neutral (safe to send / screenshot).
function highlightTokens(text: string): ReactNode {
  const re = /\[[A-Z]+_\d+\]/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <mark className="tok" key={m.index}>
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

// Draw the shareable report card (counts + verdict only — never raw values).
function drawCard(audit: Audit): void {
  const W = 1200;
  const H = 630;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return;

  const ink = "#0a0a0a";
  const muted = "#6b6b6b";
  const pii = "#b42318";
  const val = "#067647";
  const clean = audit.total === 0;
  const noun = audit.total === 1 ? "identifier" : "identifiers";

  g.fillStyle = "#fffdf2";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#ffe500"; // top band
  g.fillRect(0, 0, W, 12);

  g.textBaseline = "alphabetic";
  g.fillStyle = muted;
  g.font = "700 22px 'DM Sans', system-ui, sans-serif";
  g.fillText("SOVEREIGN SHIELD · PRIVACY SCAN", 64, 84);

  g.fillStyle = clean ? val : pii;
  g.font = "800 88px 'DM Sans', system-ui, sans-serif";
  g.fillText(clean ? "✓ Clean" : `⚠ ${audit.total}`, 64, 196);

  g.fillStyle = ink;
  g.font = "700 34px 'DM Sans', system-ui, sans-serif";
  const headline = clean
    ? "No Swiss / EU identifiers found"
    : `personal ${noun} that shouldn't reach a cloud LLM`;
  g.fillText(headline, clean ? 64 : 240, clean ? 196 : 184);

  let y = 300;
  g.font = "600 30px 'DM Sans', system-ui, sans-serif";
  if (clean) {
    g.fillStyle = muted;
    g.fillText("Nothing to redact — safe to send as-is.", 64, y);
  } else {
    for (const it of audit.items.slice(0, 6)) {
      const icon = CATEGORY_ICON[it.category] ?? "•";
      g.fillStyle = ink;
      g.fillText(`${icon}  ${it.label}`, 64, y);
      g.fillStyle = pii;
      g.font = "800 30px 'DM Sans', system-ui, sans-serif";
      g.fillText(`×${it.count}`, 640, y);
      g.font = "600 30px 'DM Sans', system-ui, sans-serif";
      y += 52;
    }
  }

  g.fillStyle = muted; // footer
  g.font = "500 24px 'DM Sans', system-ui, sans-serif";
  g.fillText("Scanned locally in the browser · nothing uploaded · shield.ars.md", 64, H - 56);

  c.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sovereign-shield-scan.png";
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

// Extract text from a PDF entirely in the browser — pdf.js is loaded on demand
// (kept out of the main bundle) and its worker is bundled, so nothing is uploaded.
async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ data }).promise;
  let out = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items) {
      if ("str" in it) out += it.str + (it.hasEOL ? "\n" : " ");
    }
    out += "\n";
  }
  return out;
}

function ScanResult(
  props: Readonly<{
    text: string;
    entities: Entity[];
    sanitized: string;
    audit: Audit;
    fileName: string | null;
    view: "found" | "sent";
    onView: (v: "found" | "sent") => void;
  }>,
) {
  const { text, entities, sanitized, audit, fileName, view, onView } = props;
  const hit = audit.total > 0;
  const noun = audit.total === 1 ? "identifier" : "identifiers";

  return (
    <>
      <div className={`verdict ${hit ? "hit" : "clean"}`}>
        <span className="verdict-big">{hit ? `⚠ ${audit.total}` : "✓ Clean"}</span>
        <span className="verdict-text">
          {hit ? (
            <>
              personal {noun} found
              {fileName && (
                <>
                  {" "}
                  in <b>{fileName}</b>
                </>
              )}{" "}
              — none of this should reach a cloud LLM
            </>
          ) : (
            <>no Swiss / EU identifiers detected — safe to send as-is</>
          )}
        </span>
      </div>

      {hit && (
        <div className="audit-items scan-tiles">
          {audit.items.map((it) => (
            <span className="a-item" key={it.category}>
              {CATEGORY_ICON[it.category] ?? "•"} {it.label} <b>×{it.count}</b>
            </span>
          ))}
        </div>
      )}

      <div className="tabs scan-tabs">
        <button className={`tab ${view === "found" ? "active" : ""}`} onClick={() => onView("found")}>
          What&apos;s in your file
        </button>
        <button className={`tab ${view === "sent" ? "active" : ""}`} onClick={() => onView("sent")}>
          What a cloud would receive
        </button>
      </div>

      <div className="scan-doc">
        {view === "found" ? highlight(text, entities) : highlightTokens(sanitized)}
      </div>

      <div className="actions">
        <button className="btn" disabled={!hit} onClick={() => drawCard(audit)}>
          ⬇ Download report card
        </button>
        <span className="muted">
          The card shows counts only — never the values. The file never left your device.
        </span>
      </div>
    </>
  );
}

export default function Scanner() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [view, setView] = useState<"found" | "sent">("found");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { entities, sanitized } = useMemo(() => tokenizeText(text), [text]);
  const audit = auditOf(entities);
  const scanned = text.trim().length > 0;

  function loadText(value: string, name: string | null) {
    setText(value);
    setFileName(name);
    setNote(null);
    setView("found");
  }

  async function readFile(file: File) {
    if (file.size > MAX_BYTES) {
      setNote(`That file is ${(file.size / 1e6).toFixed(1)} MB — please keep it under 8 MB.`);
      return;
    }
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    setBusy(true);
    try {
      if (isPdf) {
        loadText(await extractPdfText(await file.arrayBuffer()), file.name);
      } else {
        const raw = await file.text();
        if (raw.includes(String.fromCodePoint(0))) {
          setNote(`“${file.name}” looks like a binary file — paste the text instead.`);
          setFileName(file.name);
          return;
        }
        loadText(raw, file.name);
      }
    } catch {
      setNote(
        `Couldn't read “${file.name}”. A scanned or image-only PDF has no selectable text — ` +
          "paste the text instead.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadSamplePdf() {
    setBusy(true);
    try {
      const res = await fetch("/samples/leak-radar-sample.pdf");
      loadText(await extractPdfText(await res.arrayBuffer()), "leak-radar-sample.pdf");
    } catch {
      setNote("Couldn't load the sample PDF.");
    } finally {
      setBusy(false);
    }
  }


  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void readFile(file);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void readFile(file);
    e.target.value = "";
  }

  return (
    <>
      <div
        className={`drop ${dragOver ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="drop-lead">
          <b>Drop a file here</b> — or paste text below
        </div>
        <div className="drop-sub">
          .pdf · .txt · .csv · .json · .md · .log · .eml — never uploaded, read in your browser
        </div>
        <div className="drop-actions">
          <button className="replay" onClick={() => inputRef.current?.click()}>
            Choose a file
          </button>
          {SAMPLES.map((s) => (
            <button className="chip" key={s.id} onClick={() => loadText(s.text, s.label)}>
              {s.label}
            </button>
          ))}
          <button className="chip" onClick={() => void loadSamplePdf()}>
            📄 Sample PDF
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,.csv,.json,.md,.log,.eml,.text,application/pdf,text/*,application/json"
          hidden
          onChange={onPick}
        />
      </div>

      {busy && <p className="scan-note">Reading your file in the browser…</p>}
      {note && <p className="scan-note warn">{note}</p>}

      <textarea
        className="ta"
        value={text}
        spellCheck={false}
        rows={5}
        placeholder="…or paste an email, a support ticket, a CSV row, an exported chat log…"
        onChange={(e) => loadText(e.target.value, fileName)}
      />

      {scanned ? (
        <ScanResult
          text={text}
          entities={entities}
          sanitized={sanitized}
          audit={audit}
          fileName={fileName}
          view={view}
          onView={setView}
        />
      ) : (
        <p className="scan-note">
          Nothing is uploaded. Detection is the same deterministic engine the{" "}
          <a href="https://github.com/acoseac/sovereign-shield" target="_blank" rel="noreferrer">
            sovereign-shield
          </a>{" "}
          library runs, compiled to run in your browser — no server, no API key.
        </p>
      )}
    </>
  );
}
