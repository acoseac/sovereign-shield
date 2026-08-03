import type { Metadata } from "next";

import ChecksumXray from "@/components/ChecksumXray";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "How the Sovereign AI Gateway works",
  description:
    "A deterministic, offline gateway that tokenizes Swiss, EU & international personal data before a prompt reaches a public LLM, and restores it on the way back.",
};

export default function Page() {
  return (
    <main className="wrap">
      <Nav current="how" />
      <article className="prose">
        <h1>How it works</h1>
        <p className="lead">
          The gateway keeps personal data on-shore while you use any public LLM. It sits on the
          egress path, swaps every identifier for a placeholder before the prompt crosses the
          border, lets the model answer on the placeholders, and restores the real values on the way
          back — so nothing sensitive ever leaves your network.
        </p>

        <h2>The round-trip</h2>
        <pre>{`Draft a reply to Hans Muster (AHV 756.1234.5678.97, IBAN CH93 0076 …)
        │  🛡  the only thing that crosses the border ↓
Draft a reply to [PERSON_1] ([AHV_1], [IBAN_1])
        │  the model answers on placeholders ↓
"Dear [PERSON_1], we'll refund CHF 240 within five business days…"
        │  🛡  restored on the way back ↓
"Dear Hans Muster, we'll refund CHF 240 within five business days…"`}</pre>
        <p>
          The model produces a correct, personalised answer having only ever seen{" "}
          <code>[PERSON_1]</code>. Even if the provider logs every prompt, it logged placeholders.
        </p>

        <h2>Deterministic by design</h2>
        <p>
          The detection is not an LLM and not a cloud API — both would defeat the purpose (you cannot
          use an unreliable thing as your reliability boundary, and a cloud &ldquo;PII API&rdquo;
          means you have already sent the data away to find it). It is regex plus checksums, run
          locally:
        </p>
        <ul>
          <li>
            <b>Swiss AHV / AVS</b> — matched by shape, validated by its EAN-13 check digit.
          </li>
          <li>
            <b>IBAN</b> (any country) — validated by its length and ISO-7064 mod-97.
          </li>
          <li>
            <b>EU national IDs</b> — Italian codice fiscale, Spanish DNI/NIE, French NIR, and Dutch
            BSN, each validated by its own check digit or letter.
          </li>
          <li>
            <b>Card numbers</b> — validated by the Luhn algorithm.
          </li>
          <li>
            <b>Swiss phone numbers and emails</b> — matched by pattern.
          </li>
        </ul>
        <p>
          The checksums are what make it trustworthy: a random 13-digit string is not flagged, and a
          real AHV cannot slip through by being reformatted. It runs air-gapped and fails closed — if
          something looks like an identifier, it is withheld, not waved through. The principle is old
          and dull and correct: never trust the model to police itself; put a deterministic code
          boundary around it.
        </p>
        <p>See it run — pick an identifier type, then change any digit and watch the check fail:</p>
        <ChecksumXray />

        <h2>In production</h2>
        <ul>
          <li>
            An <b>OpenAI-compatible reverse proxy</b>: your app changes its <code>base_url</code> and
            nothing else. (Or an SDK/middleware, or an API-gateway plugin.)
          </li>
          <li>
            Runs <b>on-premise or in a Swiss region</b>. The token↔value map — the one place the real
            personal data lives — is in memory, per-session, and never persisted or transmitted.
          </li>
          <li>
            Every request emits an <b>audit line for the DPO</b> (&ldquo;14:32 — 1 name, 1 AHV, 1
            IBAN redacted before egress&rdquo;) — your record of processing, for free.
          </li>
          <li>
            <b>Model-agnostic.</b> Gemini, Claude, DeepSeek, a model hosted abroad — the boundary
            doesn&apos;t care, because nothing sensitive reaches any of them.
          </li>
        </ul>

        <h2>Where it stops</h2>
        <ul>
          <li>
            Structured identifiers (AHV, IBAN, EU national IDs, card, phone, email) are the
            deterministic core.
            Free-form data — names, street addresses — needs a named-entity model; run a small one
            locally alongside, and fail closed on high-risk flows.
          </li>
          <li>
            Some tasks genuinely need the real value (validate <em>this</em> IBAN; compute an age
            from a date of birth). Tokenization is a per-field policy, not a blanket switch.
          </li>
          <li>
            This is data minimisation and residency — not a DPIA, a lawful-basis analysis, or a
            contract. It removes the transfer question for the data it redacts; it does not remove
            your other obligations.
          </li>
        </ul>
        <p>Defence in depth, deliberately dumb — the outer layer, not the only one.</p>

        <p className="cta">
          <a href="/gateway">← Try the live gateway</a> &nbsp;·&nbsp;{" "}
          <a href="/benchmark">Does it cost utility? →</a>
        </p>
      </article>
    </main>
  );
}
