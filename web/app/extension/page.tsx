import type { Metadata } from "next";

import IdentifierTester from "@/components/IdentifierTester";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Browser extension — redact Swiss, EU & international identifiers in ChatGPT, Gemini & Claude",
  description:
    "A Chrome extension that redacts Swiss, EU and international identifiers before they reach ChatGPT, Gemini or Claude and restores them in the reply — 100% local. Plus a live tester for every checksum-validated identifier the shield detects.",
};

const SITES = ["ChatGPT", "Gemini", "Claude"];

export default function Page() {
  return (
    <main className="wrap">
      <Nav current="ext" />
      <header className="header">
        <h1>Browser extension</h1>
        <p className="tag">
          Use the big chat assistants without handing them Swiss, EU or international identifiers. The extension
          redacts them <strong>before</strong> the request leaves your browser and restores them in
          the reply, so the conversation still reads normally — <strong>100% local</strong>, no API
          key, no server.
        </p>
      </header>

      <section className="ext-how">
        <div className="ext-cards">
          <div className="ext-card">
            <h3>Works across</h3>
            <div className="ext-sites">
              {SITES.map((s) => (
                <span key={s} className="ext-site">
                  {s}
                </span>
              ))}
            </div>
            <p>
              One guard, three sites. It hooks the request each app makes to its model — Gemini over
              XHR, ChatGPT and Claude over <code>fetch</code> — and rewrites the outgoing prompt.
            </p>
          </div>
          <div className="ext-card">
            <h3>Checksum-only</h3>
            <p>
              It matches an identifier only when the regex shape <em>and</em> its check digit agree,
              so ordinary text is never touched. The exact same detector runs here on this page.
            </p>
          </div>
          <div className="ext-card">
            <h3>You stay in control</h3>
            <p>
              Per-category toggles decide what to block. An activity log records{" "}
              <strong>type, time and site only — never the value</strong>. The value↔placeholder map
              never leaves page memory.
            </p>
          </div>
        </div>
        <p className="ext-load">
          It is an experiment, not yet on the Chrome Web Store. Build it from{" "}
          <a
            href="https://github.com/acoseac/sovereign-shield/tree/main/extension"
            target="_blank"
            rel="noreferrer"
          >
            <code>extension/</code>
          </a>{" "}
          and load it unpacked (Developer mode → Load unpacked → <code>extension/dist</code>).
        </p>
      </section>

      <section className="ext-tester">
        <h2>Try the detectors</h2>
        <p className="tag">
          Everything the extension can redact — Swiss AHV, IBAN, card, and the Italian, Spanish,
          French, Dutch, German, Polish, Portuguese, Belgian, UK, Brazilian, South African, Chinese,
          Canadian and Indian identifiers — checked live, in your browser.
        </p>
        <IdentifierTester />
      </section>

      <footer className="foot">
        <p>
          Detection is regex + checksum, compiled to TypeScript and kept byte-for-byte in parity
          with the Python <a href="https://github.com/acoseac/sovereign-shield">sovereign-shield</a>{" "}
          source. Structured identifiers only; names and addresses need an NER model. See{" "}
          <a href="/how-it-works">how it works</a> and the{" "}
          <a href="/extension/privacy">privacy policy</a>.
        </p>
      </footer>
    </main>
  );
}
