import type { Metadata } from "next";

import Nav from "@/components/Nav";
import PresetCopy from "@/components/PresetCopy";
import { PRESETS, presetCode } from "@/lib/presets";

export const metadata: Metadata = {
  title: "Preset library — Sovereign Shield browser extension",
  description:
    "Ready-made, high-precision redaction rules for the Sovereign Shield extension — Twilio, SendGrid, npm and Databricks credentials, Azure storage keys, Slack webhooks, US DEA and Medicare identifiers. Copy a code, paste it into the extension. No account, no cloud.",
};

export default function Page() {
  return (
    <main className="wrap">
      <Nav current="ext" />
      <header className="header">
        <h1>Preset library</h1>
        <p className="tag">
          Ready-made rules for the extension&apos;s blocklist — beyond the five bundled ones.
          Copied into your extension by you; never pushed by this site.
        </p>
      </header>

      <section className="band">
        <h2>How to add one</h2>
        <ol className="preset-steps">
          <li>
            Click <strong>Copy preset code</strong> on a card below.
          </li>
          <li>
            In the extension, open <strong>Settings → Custom rules → Import preset</strong>.
          </li>
          <li>Paste, and the extension shows what it recognized before you add it.</li>
        </ol>
        <p className="preset-note">
          The clipboard is the whole transport, by design: this site has no channel into the
          extension, and the extension re-validates every pasted code with the same safety lint
          as a hand-typed rule. An imported preset becomes an ordinary custom rule — editable,
          deletable, local. If a preset&apos;s pattern is later improved here, re-importing it
          updates your copy in place.
        </p>
      </section>

      <section className="band">
        <h2>The presets</h2>
        <div className="preset-grid">
          {PRESETS.map((p) => (
            <div className="preset-card" key={p.id}>
              <h3>{p.name}</h3>
              <p>{p.description}</p>
              <p className="preset-meta">
                Example: <code>{p.example}</code>
              </p>
              <p className="preset-meta">
                Pattern: <code>{p.pattern}</code>
              </p>
              <PresetCopy code={presetCode(p)} />
            </div>
          ))}
        </div>
      </section>

      <section className="band">
        <h2>Contribute one</h2>
        <p className="preset-note">
          The library is code-reviewed data in the open repo — no uploads, no accounts. A preset
          must not duplicate a shipped detector or another preset, and it must be high-precision:
          anchored on a high-signal prefix or rigid format, never firing on prose, dates or
          ordinary reference numbers. Open a pull request against{" "}
          <a
            href="https://github.com/acoseac/sovereign-shield/blob/main/web/lib/presets.ts"
            target="_blank"
            rel="noreferrer"
          >
            web/lib/presets.ts
          </a>{" "}
          — CI enforces the policy.
        </p>
      </section>

      <footer className="foot">
        <p>
          <a href="/">← Back to the extension</a>
        </p>
      </footer>
    </main>
  );
}
