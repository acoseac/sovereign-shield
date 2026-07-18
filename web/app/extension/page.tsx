import type { Metadata } from "next";

import IdentifierTester from "@/components/IdentifierTester";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Browser extension — redact Swiss, EU & international identifiers in ChatGPT, Gemini & Claude",
  description:
    "Now live on the Chrome Web Store: a Chrome extension that redacts Swiss, EU and international identifiers before they reach ChatGPT, Gemini or Claude and restores them in the reply — 100% local. Plus a live tester for every checksum-validated identifier the shield detects.",
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
        <div className="ext-cta">
          <a
            className="ext-install"
            href="https://chromewebstore.google.com/detail/sovereign-shield-%E2%80%94-llm-pi/fbdenbfhigickkdcokpchmklopkfkkbf"
            target="_blank"
            rel="noreferrer"
          >
            Add to Chrome
          </a>
          <span className="ext-cta-note">
            v0.3.2 · live and free on the Chrome Web Store · ChatGPT, Gemini and Claude.
          </span>
        </div>
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
        <figure className="ext-shot">
          <img
            src="/ss-options.png"
            alt="The Sovereign Shield options page showing a 'What to block' grid of 20 identifier types — Swiss AHV/AVS, IBAN, credit card and national IDs across Europe, the Americas and Asia — each with its own checkbox"
            width={1280}
            height={800}
          />
          <figcaption>
            Per-category control — 20 identifier types, each its own toggle; unchecked types
            pass through untouched.
          </figcaption>
        </figure>
        <p className="ext-load">
          Prefer to build it yourself? The source is in{" "}
          <a
            href="https://github.com/acoseac/sovereign-shield/tree/main/extension"
            target="_blank"
            rel="noreferrer"
          >
            <code>extension/</code>
          </a>{" "}
          — load it unpacked (Developer mode → Load unpacked → <code>extension/dist</code>).
        </p>
      </section>

      <section className="ext-proof">
        <h2>See what stays local — before you send</h2>
        <p className="tag">
          A live count sits above the chat box and names what the guard will keep local{" "}
          <strong>before</strong> you hit send — so the redaction is something you watch, not
          something you take on trust. It reads the composer in page memory only and never
          touches the network.
        </p>
        <figure className="ext-shot">
          <img
            src="/ss-pill-chatgpt.png"
            alt="The Sovereign Shield pre-send count above the ChatGPT composer, reading '3 items (Credit card, Email, Swiss AHV / AVS) will be kept local when you send'"
            width={1280}
            height={800}
          />
          <figcaption>
            On ChatGPT: three identifiers flagged to stay local before the prompt is sent.
          </figcaption>
        </figure>
      </section>

      <section className="ext-proof">
        <h2>See it on the wire</h2>
        <p className="tag">
          A real Gemini session with the guard on. The prompt includes a Swiss AHV number, and the
          request Gemini actually sent to Google — <code>StreamGenerate</code>, open in DevTools on
          the right — carries <code>[AHV_1]</code>, never the digits. The real number, restored only
          in your browser, is what you read in the drafted reply on the left. Search the whole
          network log for the real number and you get zero hits.
        </p>
        <figure className="ext-shot">
          <img
            src="/gemini-redaction-proof.png"
            alt="A Gemini chat drafting an email that contains a Swiss AHV number, beside Chrome DevTools showing the outgoing StreamGenerate request carries the placeholder [AHV_1] instead of the real number"
            width={3040}
            height={1678}
          />
          <figcaption>
            Left: what you see. Right: what Gemini&apos;s servers received — <code>[AHV_1]</code>,
            eight times, in the request the extension rewrote (Initiator:{" "}
            <code>interceptor.js</code>).
          </figcaption>
        </figure>
      </section>

      <aside className="ext-tip">
        <strong>Using Gemini?</strong> If a pasted message doesn&apos;t send on the first Enter,
        press it again — or click the send arrow. That is Gemini&apos;s own editor dropping the first
        keypress before its send button is ready; it happens with the extension removed too. The
        guard only rewrites the outgoing request, never the send action.
      </aside>

      <section className="ext-tester">
        <h2>Try the detectors</h2>
        <p className="tag">
          All twenty identifier types the extension can redact — Swiss AHV, IBAN, card, and the
          Italian, Spanish, French, Dutch, German, Polish, Portuguese, Belgian, UK, Brazilian,
          South African, Chinese, Canadian and Indian identifiers — checked live, in your browser.
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
