import type { Metadata } from "next";

import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Sovereign Shield for data-protection teams — controls, limits & DPIA fit",
  description:
    "What the gateway does as a data-protection control, what it verifiably does not do, and where it fits in a DPIA — written for the person who has to sign off on staff using public LLMs.",
};

export default function Page() {
  return (
    <main className="wrap">
      <Nav current="gov" />
      <article className="prose">
        <h1>For data-protection teams</h1>
        <p className="lead">
          If you are the person who has to sign off on staff using ChatGPT, Gemini or Claude, this
          page is for you. It sets out — in your terms — what the gateway does as a control, what it
          verifiably does <em>not</em> do, and where it sits in a DPIA. The limits are stated as
          plainly as the capabilities, because for this reader the limits <em>are</em> the due
          diligence.
        </p>

        <h2>What the control is</h2>
        <p>
          The gateway is a <b>deterministic pseudonymisation and data-minimisation measure at the
          egress boundary</b>. Before a prompt leaves your network, it replaces each structured
          identifier with a placeholder; the model answers on the placeholders; the real values are
          restored on the way back. The token↔value map — the one place the real data lives — stays
          on your side of the boundary, in memory, for the life of the request or the browser tab,
          and is never persisted or transmitted.
        </p>
        <p>
          In GDPR terms that is pseudonymisation (Art. 4(5)) applied to reduce the personal data
          disclosed to a third-party processor (Art. 5(1)(c)); under the revised Swiss FADP the same
          reasoning applies to a cross-border disclosure. This is a technical characterisation of
          what the code does, not a legal determination about your processing — see the note at the
          foot.
        </p>

        <h2>What it does, and how you can check it yourself</h2>
        <p>
          Every claim here is something a reviewer can verify without taking our word for it:
        </p>
        <ul>
          <li>
            <b>Detection is deterministic, not a model.</b> Regex plus checksums — an AHV must pass
            its EAN-13 digit, an IBAN its mod-97, a card its Luhn. It cannot be talked out of a
            match, and it does not guess. Change any digit and watch the check fail on{" "}
            <a href="/how-it-works">How it works</a>.
          </li>
          <li>
            <b>It fails closed.</b> If something has the shape and the checksum of an identifier, it
            is withheld, not waved through. Nothing about a prompt&apos;s content is sent to us to
            decide — there is no &ldquo;us&rdquo; in the path.
          </li>
          <li>
            <b>It runs where you can audit it.</b> As an OpenAI-compatible proxy on-premise or in a
            Swiss region for a team, or as a browser extension for an individual. No account, no API
            key of ours, no analytics. The <a href="/scan">Leak Radar</a> runs the same detectors on
            a document entirely in your browser, so you can test it on your own material.
          </li>
          <li>
            <b>It leaves a record.</b> Each redaction emits a category-and-time audit line — never
            the value — which contributes to your record of the processing step. In the extension
            that log is on-device and value-free by construction.
          </li>
          <li>
            <b>It is model-agnostic.</b> Gemini, Claude, a model hosted abroad — the boundary is the
            same, because nothing sensitive reaches any of them.
          </li>
        </ul>
        <p>
          On the utility question a reviewer always asks — does redaction make the answer worse? —
          there is a measured answer rather than a reassurance: see the{" "}
          <a href="/benchmark">benchmark</a>.
        </p>

        <h2>What it does not do</h2>
        <p>
          This is the part to read closely. A structural, deterministic layer has structural blind
          spots, and pretending otherwise would be the real risk.
        </p>
        <ul>
          <li>
            <b>Names and street addresses are not detected.</b> They have no checksum, so they need
            a named-entity model — which would forfeit the determinism that makes the rest
            trustworthy. Run a local NER redactor alongside it for free-text PII, and fail closed on
            high-risk flows.
          </li>
          <li>
            <b>It is not encoding-robust.</b> A model — or a user — that base64s or ciphers an
            identifier defeats a regex. Separator and whitespace reformatting is handled; encoding
            and semantics are not.
          </li>
          <li>
            <b>It does not read intent.</b> It redacts identifiers, not the sensitivity of a
            sentence. &ldquo;My manager is being investigated&rdquo; carries no identifier and passes
            untouched.
          </li>
          <li>
            <b>It guards the typed prompt, not attached files.</b> In the browser extension, the
            contents of a document or codebase you <em>upload</em> to the chat go to the provider
            as-is — the guard inspects the message you compose, not file uploads. Treat attachments
            as an unguarded channel and redact them before you attach.
          </li>
          <li>
            <b>It is not a DPIA, a lawful-basis analysis, or a transfer-mechanism.</b> It removes the
            transfer question for the data it redacts. It does not remove your other obligations, and
            it is not legal advice.
          </li>
        </ul>

        <h2>Where it fits in a DPIA</h2>
        <p>
          Treat it as one <b>technical measure</b> in a defence-in-depth stack, sitting alongside
          your organisational ones — an acceptable-use policy, staff training, a lawful basis, and
          human review. Concretely, it helps with:
        </p>
        <div className="tablewrap">
          <table className="btable">
            <thead>
              <tr>
                <th>DPIA question</th>
                <th>What the gateway contributes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Data minimisation — is the disclosure limited to what is necessary?</td>
                <td>
                  Structured identifiers are removed before egress, so the processor receives
                  placeholders in their place.
                </td>
              </tr>
              <tr>
                <td>International transfer — does personal data leave the jurisdiction?</td>
                <td>
                  For the categories it detects, the real values do not cross the boundary. Free-text
                  PII still can — see the limits above.
                </td>
              </tr>
              <tr>
                <td>Record of processing — can you show what happened?</td>
                <td>A per-request, value-free audit line of what was redacted, and when.</td>
              </tr>
              <tr>
                <td>Residual risk — what remains, and is it managed?</td>
                <td>Stated below, rather than left for you to discover.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>Residual risk, stated plainly</h2>
        <div className="tablewrap">
          <table className="btable">
            <thead>
              <tr>
                <th>Risk</th>
                <th>Mitigation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Free-text names and addresses reach the model.</td>
                <td>Chain a local NER redactor; restrict high-risk flows by policy.</td>
              </tr>
              <tr>
                <td>An identifier is encoded or paraphrased past the regex.</td>
                <td>Deterministic layers cannot catch this; training and review must.</td>
              </tr>
              <tr>
                <td>A provider changes its internal API and a message goes out uninspected.</td>
                <td>
                  The extension warns the user in-page rather than failing silently, and offers a
                  one-click report so a moved transport is fixed quickly.
                </td>
              </tr>
              <tr>
                <td>A hostile first-party script on the chat page itself.</td>
                <td>
                  A content script shares a realm with the page and cannot win against one actively
                  hunting for it; the guard is a control against accidental disclosure, not a
                  compromised host.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="gov-cta">
          <p className="gov-cta-h">Working this out for your organisation?</p>
          <p className="gov-cta-b">
            I help Swiss and EU teams map how personal data actually flows into AI tools and put the
            right controls around it — a hands-on <b>technical</b> assessment of your data flows,
            redaction boundaries and residual exposure. It supports the DPIA your DPO and legal
            counsel own; it is not a substitute for their determination.
          </p>
          <p className="gov-cta-b">
            <a href="mailto:arsenie@odysseus.fi?subject=AI%20data-flow%20%26%20controls%20review">
              arsenie@odysseus.fi
            </a>{" "}
            &nbsp;·&nbsp; <a href="https://coseac.swiss/">who&apos;s behind this →</a>
          </p>
        </div>

        <p className="gov-note">
          <b>Not legal advice.</b> Sovereign Shield is an engineering utility that aids programmatic
          privacy mitigation. It is not an automated guarantee of regulatory compliance under the
          FADP or the GDPR. Context-dependent leak vectors — free-text names, encoded data,
          semantics — can still pass a deterministic layer. Use it alongside a DPIA where required,
          audit logs, and human review, as the outer, deliberately-dumb layer of a defence-in-depth
          stack.
        </p>

        <p className="cta">
          <a href="/how-it-works">← How it works</a> &nbsp;·&nbsp;{" "}
          <a href="/scan">Test it on your own document →</a>
        </p>
      </article>
    </main>
  );
}
