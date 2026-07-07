"use client";

import { type ReactNode, useMemo, useState } from "react";

import Nav from "@/components/Nav";
import { auditFor, auditOf, type Entity, gateway, responseFor, tokenizeText } from "@/lib/gateway";
import type { Stats } from "@/lib/store";

const TOKEN_RE = /\[[A-Z]+_\d+\]/g;

// Raw document: highlight the real PII spans (red).
function renderRaw(text: string, entities: Entity[]): ReactNode {
  const spans = [...entities].sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((e, i) => {
    if (e.start > cursor) out.push(text.slice(cursor, e.start));
    out.push(
      <mark className="pii" key={i}>
        {text.slice(e.start, e.end)}
      </mark>,
    );
    cursor = e.end;
  });
  out.push(text.slice(cursor));
  return out;
}

// Sanitized / model answer: highlight the placeholders (blue).
function renderTokens(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(TOKEN_RE);
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <mark className="tok" key={i++}>
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

// Delivered answer: swap placeholders for real values and highlight them (green).
function renderRestored(text: string, entities: Entity[]): ReactNode {
  const map = new Map(entities.map((e) => [e.token, e.value]));
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(TOKEN_RE);
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const v = map.get(m[0]);
    out.push(
      v ? (
        <mark className="val" key={i++}>
          {v}
        </mark>
      ) : (
        m[0]
      ),
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

export default function Gateway({
  initialStats,
  persistent,
}: {
  initialStats: Stats;
  persistent: boolean;
}) {
  const [docId, setDocId] = useState(gateway.documents[0].id);
  const [modelId, setModelId] = useState(gateway.models[0].id);
  const [stats, setStats] = useState<Stats>(initialStats);
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);
  const [mode, setMode] = useState<"examples" | "custom">("examples");

  const doc = gateway.documents.find((d) => d.id === docId)!;
  const model = gateway.models.find((m) => m.id === modelId)!;
  const response = responseFor(docId, modelId) ?? "";
  const audit = useMemo(() => auditFor(doc), [doc]);

  async function log() {
    setLogging(true);
    try {
      const res = await fetch("/api/results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docId }),
      });
      const data = await res.json();
      if (data.stats) setStats(data.stats);
      setLogged(true);
      setTimeout(() => setLogged(false), 2200);
    } finally {
      setLogging(false);
    }
  }

  return (
    <main className="wrap">
      <Nav current="home" />
      <header className="header">
        <h1>The Sovereign AI Gateway</h1>
        <p className="tag">
          Let your team use <strong>any</strong> LLM — Gemini, Claude, DeepSeek — while{" "}
          <strong>no personal data ever leaves Switzerland</strong>. The gateway swaps every Swiss
          identifier for a placeholder before the prompt crosses the border, the model works on the
          placeholders, and the real values are restored on the way back. Deterministic, offline,
          and it runs in your browser.
        </p>
      </header>

      <div className="tabs">
        <button
          className={`tab ${mode === "examples" ? "active" : ""}`}
          onClick={() => setMode("examples")}
        >
          Worked examples
        </button>
        <button
          className={`tab ${mode === "custom" ? "active" : ""}`}
          onClick={() => setMode("custom")}
        >
          Paste your own
        </button>
      </div>

      {mode === "custom" ? (
        <CustomMode />
      ) : (
        <>
          <div className="section-label">1 · Pick a document your staff might send</div>
      <div className="chips">
        {gateway.documents.map((d) => (
          <button
            className={`chip ${d.id === docId ? "active" : ""}`}
            key={d.id}
            onClick={() => {
              setDocId(d.id);
              setLogged(false);
            }}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="section-label">2 · Pick the model behind your app</div>
      <div className="chips">
        {gateway.models.map((m) => (
          <button
            className={`chip ${m.id === modelId ? "active" : ""}`}
            key={m.id}
            onClick={() => setModelId(m.id)}
          >
            {m.label}
            <span className="vendor">{m.vendor}</span>
          </button>
        ))}
      </div>

      <div className="pipe">
        <Step n="1" title="Your document" cap="what an employee pastes in — full of personal data">
          <div className="doc">{renderRaw(doc.text, doc.entities)}</div>
        </Step>

        <div className="gw">
          🛡️ <b>Sovereign Shield</b> redacts {audit.total} identifier{audit.total === 1 ? "" : "s"}
        </div>

        <div className="boundary">
          🇨🇭 leaves Switzerland ↓ &nbsp;·&nbsp; only the sanitized text below crosses the border
        </div>

        <Step
          n="2"
          title={`What reaches ${model.label}`}
          cap="the only thing that leaves the boundary — 0 personal-data elements"
          tone="clean"
        >
          <div className="doc">
            <span className="who">{doc.task}</span>
            {"\n\n"}
            {renderTokens(doc.sanitized)}
          </div>
        </Step>

        <Step
          n="3"
          title={`${model.label} answers`}
          cap="the model only ever sees placeholders"
          tone="clean"
        >
          <div className="doc">{response ? renderTokens(response) : "(no recorded response)"}</div>
        </Step>

        <div className="gw">🛡️ Shield restores the real values — which never left your systems</div>

        <Step
          n="4"
          title="Delivered to your user"
          cap="correct and personalised — and no PII ever crossed the border"
          tone="delivered"
        >
          <div className="doc">
            {response ? renderRestored(response, doc.entities) : "(no recorded response)"}
          </div>
        </Step>
      </div>

      <div className="section-label">Data-protection audit (what the DPO sees)</div>
      <div className="audit">
        <div className="audit-head">
          <span className="ok">✓ 0 personal-data elements crossed the border</span>
          <span className="muted">{model.label} · sanitized in-browser, deterministically</span>
        </div>
        <div className="audit-items">
          {audit.items.map((it) => (
            <span className="a-item" key={it.category}>
              {it.label} <b>×{it.count}</b>
            </span>
          ))}
        </div>
        <div className="actions">
          <button className="btn" disabled={logging} onClick={log}>
            {logging ? "Logging…" : "Log this handoff →"}
          </button>
          {logged ? <span className="saved">✓ {audit.total} kept on-shore</span> : null}
        </div>
      </div>
        </>
      )}

      <Counter stats={stats} persistent={persistent} />

      <footer className="foot">
        <p>
          The shield is a deterministic regex + checksum scanner tuned for Swiss identifiers (AHV via
          EAN-13, IBAN via mod-97, card via Luhn, phone, email) plus named entities — the same engine the{" "}
          <a href="https://github.com/acoseac/sovereign-shield" target="_blank" rel="noreferrer">
            sovereign-shield
          </a>{" "}
          library runs, ported to TypeScript and kept byte-for-byte in parity with the Python source. Nothing
          here needs an API key at runtime: detection and tokenization happen in your browser; the
          model responses shown are recorded runs on the <em>sanitized</em> prompts.
        </p>
      </footer>
    </main>
  );
}

function Step({
  n,
  title,
  cap,
  tone,
  children,
}: {
  n: string;
  title: string;
  cap: string;
  tone?: "clean" | "delivered";
  children: ReactNode;
}) {
  return (
    <div className={`step ${tone ?? ""}`}>
      <div className="step-head">
        <span className="step-n">{n}</span>
        <span className="step-title">{title}</span>
      </div>
      {children}
      <div className="step-cap">{cap}</div>
    </div>
  );
}

function Counter({ stats, persistent }: { stats: Stats; persistent: boolean }) {
  return (
    <>
      <div className="section-label">Kept in Switzerland</div>
      <div className="counter">
        <div className="big">{stats.pieces.toLocaleString("de-CH")}</div>
        <div className="csub">
          personal-data elements kept on-shore across {stats.runs.toLocaleString("de-CH")} handoff
          {stats.runs === 1 ? "" : "s"}
        </div>
      </div>
      <p className="persist-note">
        {persistent
          ? "Shared across all visitors (Upstash Redis)."
          : "In-memory only (no Redis configured) — resets on restart."}
      </p>
    </>
  );
}

const SAMPLE =
  "Please refund CHF 240 to IBAN CH9300762011623852957 (AHV 756.1234.5678.97), or to card " +
  "4111 1111 1111 1111. Reach me on +41 79 214 88 03 or hans.muster@bluewin.ch.";

function CustomMode() {
  const [text, setText] = useState(SAMPLE);
  const { entities, sanitized } = useMemo(() => tokenizeText(text), [text]);
  const audit = auditOf(entities);
  return (
    <>
      <div className="section-label">Paste any text — the shield cleans it live, in your browser</div>
      <textarea
        className="ta"
        value={text}
        spellCheck={false}
        rows={5}
        placeholder="Paste an email, a support ticket, a claim…"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="pipe">
        <Step
          n="1"
          title="Your text"
          cap="structured Swiss/EU identifiers are detected deterministically"
        >
          <div className="doc">
            {text ? renderRaw(text, entities) : "(type or paste something above)"}
          </div>
        </Step>
        <div className="gw">
          🛡️ <b>Sovereign Shield</b> redacts {audit.total} identifier{audit.total === 1 ? "" : "s"}
        </div>
        <div className="boundary">
          🇨🇭 leaves Switzerland ↓ &nbsp;·&nbsp; only the sanitized text below would cross the border
        </div>
        <Step
          n="2"
          title="What would leave the boundary"
          cap="send this to any model, then restore the real values on the way back"
          tone="clean"
        >
          <div className="doc">{renderTokens(sanitized)}</div>
        </Step>
      </div>
      <div className="audit">
        <div className="audit-head">
          <span className="ok">
            ✓ {audit.total} personal-data element{audit.total === 1 ? "" : "s"} kept on-shore
          </span>
          <span className="muted">deterministic · in-browser · no network</span>
        </div>
        <div className="audit-items">
          {audit.items.map((it) => (
            <span className="a-item" key={it.category}>
              {it.label} <b>×{it.count}</b>
            </span>
          ))}
          {audit.total === 0 ? <span className="muted">no structured PII found</span> : null}
        </div>
        <p className="custom-note">
          Deterministic detection covers structured Swiss/EU identifiers (AHV, IBAN, card, phone,
          email). Person names and street addresses need an NER model — in the worked examples
          they&apos;re annotated; here you see the deterministic core.
        </p>
      </div>
    </>
  );
}
