"use client";

import { useMemo, useState } from "react";

import { CATEGORY_LABEL, tokenizeText } from "@/lib/gateway";
import { detectPii } from "@/lib/shield";

// Synthetic, checksum-valid samples (never real people's numbers). Click to load.
const EXAMPLES: { label: string; sample: string }[] = [
  { label: "Swiss AHV", sample: "756.1234.5678.97" },
  { label: "IBAN", sample: "CH9300762011623852957" },
  { label: "Card", sample: "4111 1111 1111 1111" },
  { label: "Codice fiscale (IT)", sample: "RSSMRA85T10A562S" },
  { label: "DNI (ES)", sample: "12345678Z" },
  { label: "NIR (FR)", sample: "1 85 01 27 512 300 73" },
  { label: "BSN (NL)", sample: "111222333" },
  { label: "Steuer-ID (DE)", sample: "11223344553" },
  { label: "PESEL (PL)", sample: "90051512340" },
  { label: "NIF (PT)", sample: "123456789" },
  { label: "Rijksregisternr. (BE)", sample: "85.07.30-033.28" },
  { label: "NHS (UK)", sample: "943 476 5919" },
  { label: "CPF (BR)", sample: "111.444.777-35" },
  { label: "CNPJ (BR)", sample: "11.222.333/0001-81" },
  { label: "ID (ZA)", sample: "9001015009086" },
  { label: "Resident ID (CN)", sample: "110101199001011237" },
  { label: "SIN (CA)", sample: "130 692 544" },
  { label: "Aadhaar (IN)", sample: "2341 2341 2346" },
];

const DEFAULT_TEXT =
  "Client 756.1234.5678.97, NHS 943 476 5919, CPF 111.444.777-35 — please summarise the case.";

export default function IdentifierTester() {
  const [text, setText] = useState(DEFAULT_TEXT);
  const { hits, sanitized } = useMemo(() => {
    const h = detectPii(text);
    const { sanitized: s } = tokenizeText(text);
    return { hits: h, sanitized: s };
  }, [text]);

  return (
    <section className="idt">
      <p className="idt-help">
        Click a type to load a synthetic, checksum-valid sample, or type your own. Everything
        runs in your browser — nothing is sent anywhere.
      </p>
      <div className="idt-chips">
        {EXAMPLES.map((e) => (
          <button key={e.label} className="idt-chip" onClick={() => setText(e.sample)}>
            {e.label}
          </button>
        ))}
      </div>

      <textarea
        className="idt-input"
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        rows={3}
        spellCheck={false}
        aria-label="Text to scan for identifiers"
      />

      <div className="idt-grid">
        <div className="idt-panel">
          <h3>
            Detected <span className="idt-count">{hits.length}</span>
          </h3>
          {hits.length === 0 ? (
            <p className="idt-none">No checksum-valid identifier found.</p>
          ) : (
            <ul className="idt-hits">
              {hits.map((h, i) => (
                <li key={`${h.start}-${i}`}>
                  <span className="idt-cat">{CATEGORY_LABEL[h.category] ?? h.category}</span>
                  <code className="idt-marker">{h.marker}</code>
                  <span className="idt-ok">✓ checksum</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="idt-panel">
          <h3>What the model receives</h3>
          <pre className="idt-out">{sanitized}</pre>
          <p className="idt-help">
            Each identifier is swapped for a stable placeholder before it leaves the page, then
            restored in the reply. Clean text passes through untouched.
          </p>
        </div>
      </div>
    </section>
  );
}
