import type { Metadata } from "next";

import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Privacy policy — Sovereign Shield browser extension",
  description:
    "The Sovereign Shield browser extension processes identifiers entirely in your browser. It collects nothing, uses no servers, and transmits nothing on its own — the only exception is a breakage report you choose to send, which carries no prompt content.",
};

export default function Page() {
  return (
    <main className="wrap">
      <Nav current="ext" />
      <header className="header">
        <h1>Privacy policy</h1>
        <p className="tag">
          Sovereign Shield — LLM PII guard (browser extension). Last updated 29 July 2026.
        </p>
      </header>

      <section className="legal">
        <h2>The short version</h2>
        <p>
          The extension does its work <strong>entirely inside your browser</strong>. It collects no
          personal data, transmits nothing on its own, and has no server, account, API key or
          analytics. The one and only way anything reaches the developer is if{" "}
          <strong>you click to report</strong> a site that stopped working — described below, and it
          carries no prompt content.
        </p>

        <h2>What the extension does</h2>
        <p>
          On <code>gemini.google.com</code>, <code>chatgpt.com</code>, <code>chat.openai.com</code>{" "}
          and <code>claude.ai</code>, it inspects the request the page is about to send to its
          model, replaces any checksum-validated identifier, secret/API key, or custom term you
          configure with a placeholder <em>before</em> the request leaves your browser, and restores
          the real value in the reply you read — and in what you copy from it, so the clipboard
          matches the screen. This all happens locally, in the page.
        </p>
        <p>
          Before you send, a small counter above the chat box previews how many identifiers will be
          kept local. It reads your prompt text entirely within transient page memory — it never
          touches the network, is never written to disk, and is gone the moment the tab closes.
        </p>

        <h2>Data handling</h2>
        <ul>
          <li>
            <strong>Identifier values are never stored or transmitted.</strong> The map linking a
            value to its placeholder lives only in the page&apos;s memory for the life of the tab and
            is discarded when the tab closes or reloads.
          </li>
          <li>
            <strong>Local settings.</strong> Your on/off toggle and per-category choices are saved in
            the browser&apos;s own extension storage (<code>chrome.storage.local</code>) on your
            device only.
          </li>
          <li>
            <strong>Activity log.</strong> An on-device log records, for each redaction, the{" "}
            <strong>identifier type, the time, and the site</strong> — and <strong>never the value</strong>,
            not even a masked one. It is a rolling window you can erase at any time from the options
            page, and it never leaves your device.
          </li>
          <li>
            <strong>Breakage reports are opt-in, one click at a time.</strong> If a site changes its
            API and a message goes out uninspected, the warning banner offers to report it. Clicking
            opens a prefilled GitHub issue — or your mail client — containing four facts: the{" "}
            <strong>site&apos;s hostname, the extension version, the build stamp, and the symptom</strong>.
            Never any prompt text, redacted value, placeholder or custom term. Nothing is sent
            unless you click, and you can read and edit it before you send it.
          </li>
          <li>
            <strong>No collection, no tracking.</strong> Apart from a report you choose to send, no
            data reaches the developer or anyone else. There are no cookies, no analytics, no remote
            code.
          </li>
        </ul>

        <h2>Permissions, and why</h2>
        <ul>
          <li>
            <strong>Host access</strong> to the four chat sites above — required to read and rewrite
            the outgoing request so identifiers can be redacted before they are sent, and to restore
            them in the displayed reply. The extension runs on those sites only.
          </li>
          <li>
            <strong>Storage</strong> — to remember your settings and the value-free activity log on
            your device.
          </li>
        </ul>

        <h2>Your control</h2>
        <p>
          Clear the activity log any time from the options page. Removing the extension deletes all
          of its local data. You can also disable the guard, or any individual category, from the
          popup or options page.
        </p>

        <h2>Scope</h2>
        <p>
          The extension detects checksum-validated identifiers, common secret and API-key formats,
          and any custom keywords or patterns you configure. It does not attempt to detect names or
          addresses. It guards the prompt you type; it does <strong>not</strong> inspect the
          contents of files you attach — an uploaded document or codebase reaches the AI service
          as-is, so treat attachments as an unguarded channel. It is an independent open-source
          project and is not affiliated with Google, OpenAI or Anthropic.
        </p>

        <h2>Contact</h2>
        <p>
          Questions or issues are welcome on GitHub:{" "}
          <a href="https://github.com/acoseac/sovereign-shield/issues" target="_blank" rel="noreferrer">
            github.com/acoseac/sovereign-shield
          </a>
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
