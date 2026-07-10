"use client";

import { useMemo, useState } from "react";

import { ean13Ok, ibanMod97Ok, luhnOk } from "@/lib/shield";

type Kind = "card" | "ahv" | "iban";

const KINDS: { id: Kind; label: string; algo: string }[] = [
  { id: "ahv", label: "Swiss AHV", algo: "EAN-13 check digit" },
  { id: "iban", label: "IBAN", algo: "ISO-7064 mod-97" },
  { id: "card", label: "Card number", algo: "Luhn" },
];

const SEED: Record<Kind, string> = {
  ahv: "756.1234.5678.97",
  iban: "CH93 0076 2011 6238 5295 7",
  card: "4111 1111 1111 1111",
};

// --- traces: re-implement each algorithm to expose the intermediate steps.
// The authoritative verdict comes from the exported shield functions, so the
// pretty math below can never disagree with the real engine.

function luhnTrace(value: string) {
  const digits = value.replace(/\D/g, "");
  const parity = digits.length % 2;
  let total = 0;
  const cells = [...digits].map((ch, i) => {
    const d = Number(ch);
    const doubled = i % 2 === parity;
    let contrib = d;
    if (doubled) {
      contrib = d * 2;
      if (contrib > 9) contrib -= 9;
    }
    total += contrib;
    return { pos: i, d, doubled, contrib };
  });
  return { digits, cells, total, mod: total % 10 };
}

function ean13Trace(value: string) {
  const digits = value.replace(/\D/g, "");
  let sum = 0;
  const cells = [...digits].slice(0, 12).map((ch, i) => {
    const d = Number(ch);
    const w = i % 2 === 0 ? 1 : 3;
    sum += d * w;
    return { pos: i, d, w, p: d * w };
  });
  const check = (10 - (sum % 10)) % 10;
  const actual = digits.length >= 13 ? Number(digits[12]) : null;
  return { digits, cells, sum, check, actual };
}

function ibanTrace(value: string) {
  const s = value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  const rearranged = s.slice(4) + s.slice(0, 4);
  const letters = [...new Set([...rearranged].filter((c) => c >= "A" && c <= "Z"))].map((c) => ({
    c,
    n: Number.parseInt(c, 36),
  }));
  let mapped = "";
  for (const c of rearranged) {
    if (c >= "A" && c <= "Z") mapped += Number.parseInt(c, 36).toString();
    else if (c >= "0" && c <= "9") mapped += c;
  }
  let rem = 0;
  for (const ch of mapped) rem = (rem * 10 + Number(ch)) % 97;
  return { s, rearranged, letters, mapped, rem };
}

export default function ChecksumXray() {
  const [kind, setKind] = useState<Kind>("ahv");
  const [value, setValue] = useState(SEED.ahv);

  const valid = useMemo(() => {
    if (kind === "card") return luhnOk(value);
    if (kind === "ahv") return ean13Ok(value);
    return ibanMod97Ok(value);
  }, [kind, value]);

  function pick(k: Kind) {
    setKind(k);
    setValue(SEED[k]);
  }

  function flipLast() {
    const chars = [...value];
    for (let i = chars.length - 1; i >= 0; i--) {
      if (/\d/.test(chars[i])) {
        chars[i] = String((Number(chars[i]) + 1) % 10);
        break;
      }
    }
    setValue(chars.join(""));
  }

  return (
    <div className="xray">
      <div className="chips" style={{ marginBottom: 4 }}>
        {KINDS.map((k) => (
          <button
            className={`chip ${kind === k.id ? "active" : ""}`}
            key={k.id}
            onClick={() => pick(k.id)}
          >
            {k.label}
            <span className="vendor">{k.algo}</span>
          </button>
        ))}
      </div>

      <div className="xray-input">
        <input
          className="ta xin"
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          aria-label="value to check"
        />
        <span className={`xverdict ${valid ? "ok" : "bad"}`}>
          {valid ? "✓ valid" : "✗ invalid"}
        </span>
      </div>

      {kind === "card" ? <LuhnView t={luhnTrace(value)} valid={valid} /> : null}
      {kind === "ahv" ? <Ean13View t={ean13Trace(value)} valid={valid} /> : null}
      {kind === "iban" ? <IbanView t={ibanTrace(value)} valid={valid} /> : null}

      <div className="xray-foot">
        <button className="replay" onClick={flipLast}>
          Change one digit
        </button>
        <button className="chip" onClick={() => setValue(SEED[kind])}>
          Reset
        </button>
        <span className="muted">
          No lookup, no network, no AI — pure arithmetic. Change any digit and the check fails, which
          is exactly why a random string can&apos;t pose as a real identifier.
        </span>
      </div>
    </div>
  );
}

function LuhnView({ t, valid }: Readonly<{ t: ReturnType<typeof luhnTrace>; valid: boolean }>) {
  const bad = t.digits.length < 13 || t.digits.length > 19;
  return (
    <div className="xray-body">
      <div className="xcells" key={t.digits}>
        {t.cells.map((c) => (
          <span
            className={`xcell ${c.doubled ? "dbl" : ""}`}
            style={{ ["--i" as string]: c.pos }}
            key={c.pos}
          >
            <span className="xd">{c.d}</span>
            <span className="xsub">{c.doubled ? `×2→${c.contrib}` : c.contrib}</span>
          </span>
        ))}
      </div>
      <div className="xmath">
        <span>
          double every 2nd digit from the right (subtract 9 if &gt; 9) · Σ = <b>{t.total}</b>
        </span>
        <span className={valid ? "ok" : "bad"}>
          {t.total} mod 10 = {t.mod} {valid ? "→ valid ✓" : "→ ≠ 0, invalid ✗"}
        </span>
      </div>
      {bad ? <p className="muted">A card number is 13–19 digits — this is {t.digits.length}.</p> : null}
    </div>
  );
}

function Ean13View({ t, valid }: Readonly<{ t: ReturnType<typeof ean13Trace>; valid: boolean }>) {
  const eq = valid ? "=" : "≠";
  const tail = valid ? "→ valid ✓" : "→ invalid ✗";
  const msg =
    t.actual === null
      ? "needs 13 digits"
      : `computed ${t.check} ${eq} digit 13 (${t.actual}) ${tail}`;
  return (
    <div className="xray-body">
      <div className="xcells" key={t.digits}>
        {t.cells.map((c) => (
          <span
            className={`xcell ${c.w === 3 ? "dbl" : ""}`}
            style={{ ["--i" as string]: c.pos }}
            key={c.pos}
          >
            <span className="xd">{c.d}</span>
            <span className="xsub">×{c.w}</span>
          </span>
        ))}
        <span className="xcell chk" style={{ ["--i" as string]: 12 }}>
          <span className="xd">{t.actual ?? "—"}</span>
          <span className="xsub">check</span>
        </span>
      </div>
      <div className="xmath">
        <span>
          weight the first 12 digits 1·3·1·3… · Σ = <b>{t.sum}</b> · check = (10 − {t.sum} mod 10) mod
          10 = <b>{t.check}</b>
        </span>
        <span className={valid ? "ok" : "bad"}>{msg}</span>
      </div>
    </div>
  );
}

function IbanView({ t, valid }: Readonly<{ t: ReturnType<typeof ibanTrace>; valid: boolean }>) {
  return (
    <div className="xray-body">
      <div className="xsteps">
        <div className="xstep">
          <span className="xstep-n">1</span>
          <span className="xstep-b">
            move the country code + check digits to the end: <code>{t.rearranged}</code>
          </span>
        </div>
        <div className="xstep">
          <span className="xstep-n">2</span>
          <span className="xstep-b">
            letters → numbers (A=10 … Z=35):{" "}
            {t.letters.length
              ? t.letters.map((l) => (
                  <span className="xmap" key={l.c}>
                    {l.c}={l.n}
                  </span>
                ))
              : "—"}
          </span>
        </div>
        <div className="xstep">
          <span className="xstep-n">3</span>
          <span className="xstep-b mono-wrap">
            <code>{t.mapped || "—"}</code>
          </span>
        </div>
        <div className="xstep">
          <span className="xstep-n">4</span>
          <span className={`xstep-b ${valid ? "ok" : "bad"}`}>
            mod 97 = <b>{t.rem}</b> {valid ? "→ equals 1, valid ✓" : "→ ≠ 1, invalid ✗"}
          </span>
        </div>
      </div>
    </div>
  );
}
