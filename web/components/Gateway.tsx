"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import Nav from "@/components/Nav";
import { auditFor, auditOf, type Entity, gateway, responseFor, tokenizeText } from "@/lib/gateway";
import type { Stats } from "@/lib/store";

const TOKEN_RE = /\[[A-Z]+_\d+\]/g;

// Timeline tuning (ms).
const PER_CHAR = 5;
const MIN_D = 320;
const MAX_D = 850;
const GAP = 300;
const END_PAD = 250;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

interface Win {
  start: number;
  end: number;
}
function buildTimeline(texts: string[]): { wins: Win[]; total: number } {
  const wins: Win[] = [];
  let t = 0;
  texts.forEach((tx, i) => {
    if (i > 0) t += GAP;
    const d = Math.max(MIN_D, Math.min(MAX_D, Math.round(tx.length * PER_CHAR)));
    wins.push({ start: t, end: t + d });
    t += d;
  });
  return { wins, total: t + END_PAD };
}
function visibleLen(full: string, win: Win, elapsed: number): { n: number; typing: boolean } {
  if (elapsed <= win.start) return { n: 0, typing: false };
  const p = Math.min(1, (elapsed - win.start) / (win.end - win.start));
  return { n: Math.round(p * full.length), typing: p < 1 };
}

// Raw document up to `limit` chars: highlight the real PII spans (red).
function renderRaw(text: string, entities: Entity[], limit: number): ReactNode {
  const vis = text.slice(0, limit);
  const spans = entities.filter((e) => e.end <= limit).sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((e, i) => {
    if (e.start > cursor) out.push(vis.slice(cursor, e.start));
    out.push(
      <mark className="pii" key={i}>
        {vis.slice(e.start, e.end)}
      </mark>,
    );
    cursor = e.end;
  });
  out.push(vis.slice(cursor));
  return out;
}

// Sanitized text / model answer: highlight complete placeholders (neutral chip).
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

// Delivered answer: swap complete placeholders for real values (green).
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
  const [runId, setRunId] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const reduced = usePrefersReducedMotion();

  const doc = gateway.documents.find((d) => d.id === docId)!;
  const model = gateway.models.find((m) => m.id === modelId)!;
  const response = responseFor(docId, modelId) ?? "";
  const audit = useMemo(() => auditFor(doc), [doc]);

  const texts = useMemo(
    () => [doc.text, doc.sanitized, response, response],
    [doc.text, doc.sanitized, response],
  );
  const { wins, total } = useMemo(() => buildTimeline(texts), [texts]);

  // Drive the reveal with requestAnimationFrame; restart on doc/model/replay change.
  useEffect(() => {
    if (reduced) {
      setElapsed(total);
      return;
    }
    setElapsed(0);
    let raf = 0;
    let startTs: number | null = null;
    const tick = (ts: number) => {
      if (startTs === null) startTs = ts;
      const e = ts - startTs;
      setElapsed(Math.min(e, total));
      if (e < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [texts, total, runId, reduced]);

  const done = elapsed >= total;
  const started = (i: number) => elapsed >= wins[i].start;
  const connOn = (i: number) => elapsed >= wins[i].start - GAP + 120;

  const v1 = visibleLen(texts[0], wins[0], elapsed);
  const v2 = visibleLen(texts[1], wins[1], elapsed);
  const v3 = visibleLen(texts[2], wins[2], elapsed);
  const v4 = visibleLen(texts[3], wins[3], elapsed);

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

  function pick(setter: (v: string) => void, v: string) {
    setter(v);
    setLogged(false);
  }

  return (
    <main className="wrap">
      <Nav current="home" />
      <header className="header">
        <h1>The Sovereign Gateway</h1>
        <p className="tag">
          Use any LLM while <strong>no personal data leaves Switzerland</strong> — watch a Swiss
          document get tokenized on the way out and restored on the way back, live in your browser.
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
          <div className="section-label">1 · Pick a document</div>
          <div className="chips">
            {gateway.documents.map((d) => (
              <button
                className={`chip ${d.id === docId ? "active" : ""}`}
                key={d.id}
                onClick={() => pick(setDocId, d.id)}
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
                onClick={() => pick(setModelId, m.id)}
              >
                {m.label}
                <span className="vendor">{m.vendor}</span>
              </button>
            ))}
          </div>

          <div className="flowbar">
            <span className="lead">
              <b>{audit.total}</b> Swiss identifier{audit.total === 1 ? "" : "s"} tokenized · 0 cross
              the border
            </span>
            <button className="replay" onClick={() => setRunId((r) => r + 1)}>
              ↻ Replay
            </button>
          </div>

          <div className="flow">
            <Stage
              n="1"
              title="Your document"
              cap="real Swiss PII an employee pastes in"
              tone="home"
              show={started(0)}
              active={v1.typing}
            >
              {renderRaw(texts[0], doc.entities, v1.n)}
              {v1.typing && <span className="cursor" />}
            </Stage>

            <Conn on={connOn(1)} border top="🛡 redact" arrow="→" bottom="leaves 🇨🇭" />

            <Stage
              n="2"
              title={`Sent to ${model.label}`}
              cap="the only thing that crosses the border — 0 real values"
              show={started(1)}
              active={v2.typing}
            >
              <span className="who">{doc.task}</span>
              {renderTokens(texts[1].slice(0, v2.n))}
              {v2.typing && <span className="cursor" />}
            </Stage>

            <Conn on={connOn(2)} top="🤖" arrow="→" bottom="answers" />

            <Stage
              n="3"
              title={`${model.label} replies`}
              cap="the model only ever sees placeholders"
              show={started(2)}
              active={v3.typing}
            >
              {response ? renderTokens(texts[2].slice(0, v3.n)) : "(no recorded response)"}
              {v3.typing && <span className="cursor" />}
            </Stage>

            <Conn on={connOn(3)} border top="🛡 restore" arrow="→" bottom="back 🇨🇭" />

            <Stage
              n="4"
              title="Delivered to your user"
              cap="correct and personalised — and no PII ever left"
              tone="delivered"
              show={started(3)}
              active={v4.typing}
            >
              {response ? renderRestored(texts[3].slice(0, v4.n), doc.entities) : "(no recorded response)"}
              {v4.typing && <span className="cursor" />}
            </Stage>
          </div>

          <div className={`audit ${done ? "show" : ""}`}>
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
          Deterministic regex + checksum detection (AHV via EAN-13, IBAN via mod-97, card via Luhn,
          phone, email) — the same engine the open-source{" "}
          <a href="https://github.com/acoseac/sovereign-shield" target="_blank" rel="noreferrer">
            sovereign-shield
          </a>{" "}
          library runs, ported to TypeScript and kept byte-for-byte in parity with the Python source.
          No API keys: detection runs in your browser; the model replies shown are recorded runs on
          the <em>sanitized</em> prompts.
        </p>
      </footer>
    </main>
  );
}

function Stage({
  n,
  title,
  cap,
  tone,
  show,
  active,
  children,
}: {
  n: string;
  title: string;
  cap: string;
  tone?: "home" | "delivered";
  show: boolean;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`stage ${tone ?? ""} ${show ? "show" : ""} ${active ? "active" : ""}`}>
      <div className="stage-head">
        <span className="stage-n">{n}</span>
        <span className="stage-title">{title}</span>
      </div>
      <div className="stage-body">{children}</div>
      <div className="stage-cap">{cap}</div>
    </div>
  );
}

function Conn({
  on,
  border,
  top,
  arrow,
  bottom,
}: {
  on: boolean;
  border?: boolean;
  top: string;
  arrow: string;
  bottom: string;
}) {
  return (
    <div className={`conn ${border ? "border" : ""} ${on ? "on" : ""}`}>
      <span className="lbl">{top}</span>
      <span className="arrow">{arrow}</span>
      <span className="lbl">{bottom}</span>
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
        rows={4}
        placeholder="Paste an email, a support ticket, a claim…"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flow">
        <Stage n="1" title="Your text" cap="structured Swiss/EU identifiers, detected live" show active={false}>
          {text ? renderRaw(text, entities, text.length) : "(type or paste something above)"}
        </Stage>
        <Conn on border top="🛡 redact" arrow="→" bottom="would leave 🇨🇭" />
        <Stage
          n="2"
          title="What would cross the border"
          cap="send this to any model, then restore the real values on the way back"
          show
          active={false}
        >
          {renderTokens(sanitized)}
        </Stage>
      </div>
      <div className="audit show">
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
