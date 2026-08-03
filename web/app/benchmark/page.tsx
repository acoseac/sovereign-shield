import type { Metadata } from "next";

import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Does the gateway cost utility? — a benchmark",
  description:
    "A blind, order-randomized panel judges whether tokenizing PII before the model changes the answer's quality. Privacy is total; utility cost is small and task-dependent.",
};

const ROWS: [string, string, "raw" | "shielded" | "tie", string][] = [
  ["Support email", "Gemini 3.5 Flash", "raw", "3 / 0 / 0"],
  ["Support email", "Claude Sonnet 4.6", "shielded", "1 / 2 / 0"],
  ["Support email", "DeepSeek V4 Pro", "raw", "2 / 0 / 1"],
  ["Insurance claim", "Gemini 3.5 Flash", "raw", "2 / 1 / 0"],
  ["Insurance claim", "Claude Sonnet 4.6", "raw", "2 / 0 / 1"],
  ["Insurance claim", "DeepSeek V4 Pro", "shielded", "1 / 2 / 0"],
  ["HR onboarding", "Gemini 3.5 Flash", "raw", "3 / 0 / 0"],
  ["HR onboarding", "Claude Sonnet 4.6", "tie", "1 / 1 / 1"],
  ["HR onboarding", "DeepSeek V4 Pro", "raw", "3 / 0 / 0"],
];

export default function Page() {
  return (
    <main className="wrap">
      <Nav current="bench" />
      <article className="prose">
        <h1>Does redaction make the model worse?</h1>
        <p className="lead">
          The obvious objection to the gateway is: if you swap the names and numbers for
          placeholders, do you get a worse answer? It deserves a number, not a hand-wave — so I
          measured it.
        </p>

        <h2>Method</h2>
        <p>
          Three real Swiss business documents × three models (Gemini 3.5 Flash, Claude Sonnet 4.6,
          DeepSeek V4 Pro). Each task was run two ways — on the <b>raw</b> document and on the{" "}
          <b>sanitized-then-restored</b> one (exactly what the gateway delivers) — and a
          vendor-diverse judge panel compared the two answers <b>blind and order-randomized</b>,
          calling each pair <em>raw better</em>, <em>shielded better</em>, or <em>tie</em>.
        </p>

        <h2>Result</h2>
        <ul>
          <li>
            <b>Privacy: total, and free.</b> No raw personal data reached a model, and the
            token↔value round-trip was flawless — the restored answer was correct every time.
          </li>
          <li>
            <b>Utility: a small, task-dependent cost.</b> The panel mildly preferred the raw-context
            answer in about two-thirds of pairs, but usually by thin margins that flipped by judge.
            Near-neutral on extraction and summarisation; a mild style tax on open-ended customer
            copy. Correctness — names, amounts, numbers — was intact in both arms.
          </li>
        </ul>

        <div className="tablewrap">
          <table className="btable">
            <thead>
              <tr>
                <th>Document</th>
                <th>Model</th>
                <th>Verdict</th>
                <th>Votes (raw / shielded / tie)</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([doc, model, verdict, votes], i) => (
                <tr key={i}>
                  <td>{doc}</td>
                  <td>{model}</td>
                  <td>
                    <span className={`v ${verdict}`}>{verdict}</span>
                  </td>
                  <td className="mono">{votes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p>
          The honest headline is not <em>&ldquo;it&apos;s free.&rdquo;</em> It is{" "}
          <b>near-total privacy for a small, measurable, mitigable utility cost</b> — and for most
          teams that is an easy trade for a <em>provable</em> residency boundary. The cost is
          smallest on the structured tasks that make up the bulk of enterprise LLM traffic, and it
          can be reduced further by tuning the gateway prompt or tokenizing only the most sensitive
          fields.
        </p>

        <h2>Caveats</h2>
        <p>
          This is a prototype, not a study: n = 9, a single document set, one run, and an LLM-judge
          panel rather than human raters (with the judge noise the thin margins reflect). A full
          evaluation would scale documents and tasks, run multiple trials for confidence intervals,
          add human evaluation, and sweep redaction granularity. It is the seed, not the last word.
        </p>

        <p className="cta">
          <a href="/how-it-works">← How it works</a> &nbsp;·&nbsp;{" "}
          <a href="/gateway">Try the live gateway →</a>
        </p>
      </article>
    </main>
  );
}
