"use client";

import { type ReactNode, useMemo, useState } from "react";

import { buildPreview, pillText, type PreviewSpan } from "@/lib/demo";

interface Scenario {
  id: string;
  label: string;
  term: string;
  text: string;
}

// Every value below is synthetic — checksum-valid but not a real person's, and the keys
// are documentation samples. Same rule as the rest of the site.
const SCENARIOS: Scenario[] = [
  {
    id: "support",
    label: "A support reply",
    term: "Northwind",
    text:
      "Draft a friendly reply: we double-charged card 4111 1111 1111 1111 for CHF 240. " +
      "Refund to IBAN CH9300762011623852957, confirm to hans.muster@bluewin.ch, and put " +
      "AHV 756.1234.5678.97 on the case. It's a Northwind account.",
  },
  {
    id: "debug",
    label: "A stack trace",
    term: "",
    text:
      "Why does this fail with 401? The deploy uses AKIAIOSFODNN7EXAMPLE and the service " +
      "account key AIzaSyD8fXcVb2N1qLpR4tGh7JkM0sWxYzA3Bcd. Reply to dev@example-corp.ch.",
  },
  {
    id: "brief",
    label: "A client brief",
    term: "Northwind",
    text:
      "Summarise for the Northwind steering call: French contact NIR 1 85 01 27 512 300 73, " +
      "mobile +41 79 214 88 03, invoices to billing@northwind-group.example.",
  },
];

// One synthetic sample per remaining identifier type — click to append it to the prompt.
const MORE_TYPES: { label: string; sample: string }[] = [
  { label: "Codice fiscale (IT)", sample: "RSSMRA85T10A562S" },
  { label: "DNI (ES)", sample: "12345678Z" },
  { label: "BSN (NL)", sample: "111222333" },
  { label: "Steuer-ID (DE)", sample: "11223344553" },
  { label: "PESEL (PL)", sample: "90051512340" },
  { label: "NIF (PT)", sample: "501964843" },
  { label: "Rijksregisternr. (BE)", sample: "85.07.30-033.28" },
  { label: "NHS (UK)", sample: "943 476 5919" },
  { label: "CPF (BR)", sample: "111.444.777-35" },
  { label: "CNPJ (BR)", sample: "11.222.333/0001-81" },
  { label: "ID (ZA)", sample: "9001015009086" },
  { label: "Resident ID (CN)", sample: "110101199001011237" },
  { label: "SIN (CA)", sample: "130 692 544" },
  { label: "Aadhaar (IN)", sample: "2341 2341 2346" },
  { label: "GitHub token", sample: "ghp_1234567890abcdefghijklmnopqrstuvwxyz" },
  { label: "Slack token", sample: "xoxb-1234567890-abcdefghijkl" },
];

const SITES = ["ChatGPT", "Gemini", "Claude"];

function renderOutgoing(text: string, spans: PreviewSpan[]): ReactNode {
  const out: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((s, i) => {
    if (s.start > cursor) out.push(text.slice(cursor, s.start));
    out.push(
      <mark className={s.surrogate ? "sur" : "tok"} key={i}>
        {s.replacement}
      </mark>,
    );
    cursor = s.end;
  });
  out.push(text.slice(cursor));
  return out;
}

export default function ExtensionDemo() {
  const [scenario, setScenario] = useState(SCENARIOS[0].id);
  const [text, setText] = useState(SCENARIOS[0].text);
  const [term, setTerm] = useState(SCENARIOS[0].term);
  const [smokescreen, setSmokescreen] = useState(false);

  const preview = useMemo(() => buildPreview(text, { term, smokescreen }), [text, term, smokescreen]);

  function loadScenario(s: Scenario) {
    setScenario(s.id);
    setText(s.text);
    setTerm(s.term);
  }

  return (
    <div className="demo">
      <div className="demo-bar">
        <div className="demo-chips">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className={`chip ${scenario === s.id ? "active" : ""}`}
              onClick={() => loadScenario(s)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="demo-switch">
          <input
            type="checkbox"
            checked={smokescreen}
            onChange={(e) => setSmokescreen(e.target.checked)}
          />
          <span>Smokescreen</span>
        </label>
      </div>

      <div className="demo-panes">
        <section className="demo-pane">
          <h3 className="demo-pane-h">You type</h3>
          <div className={`demo-pill ${preview.count === 0 ? "quiet" : ""}`}>
            {preview.count === 0
              ? "🛡️ Nothing to keep local — this prompt is clean"
              : pillText(preview, smokescreen)}
          </div>
          <textarea
            className="demo-input"
            value={text}
            rows={6}
            spellCheck={false}
            aria-label="Prompt to inspect"
            onChange={(e) => {
              setText(e.target.value);
              setScenario("");
            }}
          />
          <label className="demo-term">
            <span>Your own term</span>
            <input
              type="text"
              value={term}
              placeholder="a client, a code name, a domain…"
              aria-label="A custom term to redact"
              onChange={(e) => setTerm(e.target.value)}
            />
          </label>
        </section>

        <section className="demo-pane out">
          <h3 className="demo-pane-h">
            What the provider receives
            <span className="demo-sites">
              {SITES.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </span>
          </h3>
          <pre className="demo-out">{renderOutgoing(text, preview.spans)}</pre>
          {smokescreen && preview.surrogatable < preview.count && (
            <p className="demo-why">
              The checksum-validated ones keep their bracket token: a valid-looking fake AHV or
              IBAN would be some real person&apos;s number.
            </p>
          )}
          {preview.count > 0 && (
            <ul className="demo-hits">
              {preview.spans.map((s, i) => (
                <li key={`${s.start}-${i}`}>
                  <b>{s.label}</b>
                  <code>{s.marker}</code>
                  {s.checksummed ? <span className="ok">✓ checksum</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <details className="demo-more">
        <summary>Try another identifier type</summary>
        <div className="demo-chips">
          {MORE_TYPES.map((t) => (
            <button
              key={t.label}
              className="demo-chip"
              onClick={() => {
                setText((prev) => `${prev.trimEnd()} ${t.sample}`);
                setScenario("");
              }}
            >
              + {t.label}
            </button>
          ))}
        </div>
      </details>

      <p className="demo-foot">
        Detection runs in this tab, from the same source the extension bundles — nothing you
        type here reaches a network. Every value above is synthetic.
      </p>
    </div>
  );
}
