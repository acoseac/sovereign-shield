import type { Metadata } from "next";

import Nav from "@/components/Nav";
import Scanner from "@/components/Scanner";

export const metadata: Metadata = {
  title: "Leak Radar — scan a file for Swiss, EU & international personal data, in your browser",
  description:
    "Drop a file or paste text and see every Swiss, EU & international identifier (AHV, IBAN, cards, national IDs) it contains before it ever reaches a cloud LLM. Deterministic, offline, nothing uploaded.",
};

export default function Page() {
  return (
    <main className="wrap">
      <Nav current="scan" />
      <header className="header">
        <h1>Leak Radar</h1>
        <p className="tag">
          Drop a file or paste text — see exactly what personal data you&apos;d be handing a cloud
          LLM. It&apos;s scanned <strong>in your browser</strong> by the same deterministic engine as
          the gateway: nothing is uploaded, no API, no keys.
        </p>
      </header>

      <Scanner />

      <footer className="foot">
        <p>
          Detection is regex + checksum — Swiss AHV, IBAN worldwide, cards via Luhn, phone and
          email, plus national IDs for Italy, Spain, France, the Netherlands, Germany, Poland,
          Portugal, Belgium, the UK, Brazil, South Africa, China, Canada and India — the{" "}
          <a href="https://github.com/acoseac/sovereign-shield" target="_blank" rel="noreferrer">
            sovereign-shield
          </a>{" "}
          library compiled to TypeScript and kept byte-for-byte in parity with the Python source.
          Structured identifiers only; names and street addresses need an NER model. See{" "}
          <a href="/how-it-works">how it works</a>.
        </p>
      </footer>
    </main>
  );
}
