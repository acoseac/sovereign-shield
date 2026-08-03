import type { Metadata } from "next";
import Link from "next/link";

import ExtensionDemo from "@/components/ExtensionDemo";
import Nav from "@/components/Nav";
import ShotTabs from "@/components/ShotTabs";

export const metadata: Metadata = {
  title: "Sovereign Shield — redact identifiers, API keys & your own terms in ChatGPT, Gemini & Claude",
  description:
    "A free Chrome extension that replaces Swiss, EU and international identifiers, developer secrets and your own terms with placeholders before your prompt reaches ChatGPT, Gemini or Claude — and restores them in the reply. 100% local: no account, no server, no analytics. Try the live detector on this page.",
};

const STORE_URL =
  "https://chromewebstore.google.com/detail/sovereign-shield-%E2%80%94-llm-pi/fbdenbfhigickkdcokpchmklopkfkkbf";

const TRUST = ["100% local", "no account", "no analytics", "open source"];

export default function Page() {
  return (
    <main className="wrap">
      <Nav current="ext" />

      <header className="header hero">
        <h1>Redact your prompt before it leaves the browser</h1>
        <p className="tag">
          A Chrome extension for ChatGPT, Gemini and Claude. Identifiers, API keys and your own
          terms become placeholders on the way out, and the real values come back in the reply —
          all inside the page.
        </p>
        <div className="ext-cta">
          <a className="ext-install" href={STORE_URL} target="_blank" rel="noreferrer">
            Add to Chrome
          </a>
          <span className="ext-cta-note">v0.8.3 · free · Chrome 111+</span>
        </div>
        <ul className="trust">
          {TRUST.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </header>

      <section className="band">
        <h2>Type something. Watch what the model would get.</h2>
        <ExtensionDemo />
      </section>

      <section className="band">
        <h2>What it catches</h2>
        <div className="ext-cards">
          <div className="ext-card">
            <h3>20 identifiers</h3>
            <p>
              Shape <em>and</em> check digit must agree, so ordinary text is never touched — Swiss
              AHV, IBAN, cards, and national IDs across Europe, the Americas and Asia.
            </p>
          </div>
          <div className="ext-card">
            <h3>9 secrets</h3>
            <p>
              AWS, OpenAI, Anthropic, Google, GitHub, Slack and Stripe keys, JWTs and PEM private
              keys — matched on their structured credential shape.
            </p>
          </div>
          <div className="ext-card">
            <h3>Your own terms</h3>
            <p>
              A client name, a code name, a domain, a regex. Or add one from the{" "}
              <strong>ready-made library</strong> in a click: US SSN, UK NI, internal IPs,
              hostnames, MAC addresses.
            </p>
          </div>
        </div>
      </section>

      <section className="band">
        <h2>Proof, not promises</h2>
        <ShotTabs />
      </section>

      <section className="band">
        <h2>The fine print</h2>
        <div className="faq">
          <details>
            <summary>Where do the real values ever appear?</summary>
            <p>
              Three places, all local: the text painted on screen, what you copy from it, and the
              inspector panel. Never the request, never extension storage, never the activity log —
              which records type, time and site, and never a value.
            </p>
          </details>
          <details>
            <summary>Smokescreen: stand-ins instead of [EMAIL_1]</summary>
            <p>
              Off by default. With it on, an email or a custom term is sent as a plausible stand-in
              like <code>alice.morgan@example.org</code>, which reads as ordinary prose to the
              model. Checksum-validated identifiers never get one — a valid-looking fake AHV or
              IBAN would be some real person&apos;s number.
            </p>
          </details>
          <details>
            <summary>What happens if a site changes its API?</summary>
            <p>
              You get told. The guard hooks each site&apos;s real endpoint by name; if your composer
              drains and no request went through it, a banner says{" "}
              <strong>that message was not inspected</strong> — and offers to report it in one
              click. The report carries the hostname, version, build stamp and symptom, and nothing
              else. It is the extension&apos;s only outbound channel, and only if you click.
            </p>
          </details>
          <details>
            <summary>What it does not do</summary>
            <p>
              It guards the prompt you type — <strong>not the files you attach</strong>, so redact a
              document before you upload it. Names and street addresses have no checksum and need a
              named-entity model, so they are deliberately left alone. And it doesn&apos;t try to
              survive deliberate obfuscation: it is the outer, deliberately-dumb layer of a
              defence-in-depth stack.
            </p>
          </details>
          <details>
            <summary>Using Gemini? One quirk worth knowing</summary>
            <p>
              If a pasted message doesn&apos;t send on the first Enter, press it again or click the
              send arrow. That is Gemini&apos;s own editor dropping the first keypress before its
              send button is ready — it happens with the extension removed too. The guard only
              rewrites the outgoing request, never the send action.
            </p>
          </details>
          <details>
            <summary>Build it from source</summary>
            <p>
              The source is in{" "}
              <a
                href="https://github.com/acoseac/sovereign-shield/tree/main/extension"
                target="_blank"
                rel="noreferrer"
              >
                <code>extension/</code>
              </a>{" "}
              — <code>npm run build</code>, then Developer mode → Load unpacked →{" "}
              <code>extension/dist</code>.
            </p>
          </details>
        </div>
        <p className="fine-more">
          <a href="/extension/privacy">Privacy policy</a> — what is stored, and the one thing that
          can ever be sent.
        </p>
      </section>

      <section className="band">
        <h2>The rest of the project</h2>
        <div className="more-grid">
          <Link className="more-card" href="/gateway">
            <span className="more-k">Live demo</span>
            <span className="more-h">The gateway</span>
            <span className="more-d">
              The same boundary as a proxy in front of your own app — watch a document get
              tokenized on the way out and restored on the way back.
            </span>
          </Link>
          <Link className="more-card" href="/scan">
            <span className="more-k">Tool</span>
            <span className="more-h">Leak Radar</span>
            <span className="more-d">
              Drop a file and see what you&apos;d be handing a cloud LLM. Scanned in your browser;
              nothing is uploaded.
            </span>
          </Link>
          <Link className="more-card" href="/how-it-works">
            <span className="more-k">Explainer</span>
            <span className="more-h">How it works</span>
            <span className="more-d">
              Why the boundary is regex and checksums rather than a model — with the check digits
              worked through, live.
            </span>
          </Link>
          <Link className="more-card" href="/benchmark">
            <span className="more-k">Numbers</span>
            <span className="more-h">Does it cost utility?</span>
            <span className="more-d">
              Three real documents, three models, judged blind — what redaction costs an answer,
              measured rather than guessed.
            </span>
          </Link>
        </div>
      </section>

      <footer className="foot">
        <p>
          Detection is regex + checksum, compiled to TypeScript and kept byte-for-byte in parity
          with the Python{" "}
          <a href="https://github.com/acoseac/sovereign-shield" target="_blank" rel="noreferrer">
            sovereign-shield
          </a>{" "}
          source. An independent open-source project, Apache-2.0 — not affiliated with Google,
          OpenAI or Anthropic.
        </p>
      </footer>
    </main>
  );
}
