"use client";

import { useState } from "react";

interface Shot {
  id: string;
  tab: string;
  src: string;
  alt: string;
  w: number;
  h: number;
  cap: string;
}

// Real captures of the shipped 0.8.x build, not mockups. The PNG originals are the store
// upload set (extension/store-assets/); these are near-lossless WebP copies at the same
// 1280×800 — pixel-identical text, roughly half the bytes.
const SHOTS: Shot[] = [
  {
    id: "gemini",
    tab: "On Gemini",
    src: "/ss-inspector-gemini.webp",
    alt: "The Sovereign Shield inspector open beside a Gemini composer. The 'You typed' pane shows a name, an AHV number, an IBAN, a mobile number, an email and a card number; the 'What the provider receives' pane shows the same text with [AHV_1], [IBAN_1], [PHONE_1], [CARD_1] and the stand-in address alice.morgan@example.org in their place",
    w: 1280,
    h: 800,
    cap: "Your prompt on top, what Gemini would actually receive below — five values replaced. Smokescreen is on here, so the email left as a stand-in while the checksum-validated ones stay bracket tokens. The name is untouched: names have no check digit to verify, so the guard doesn't guess.",
  },
  {
    id: "chatgpt",
    tab: "On ChatGPT",
    src: "/ss-inspector-chatgpt.webp",
    alt: "The same inspector on ChatGPT, showing a deploy script whose OpenAI, AWS and GitHub keys have become [OPENAI_1], [AWS_1] and [GITHUB_1], with the pre-send count reading '4 items (AWS access key, Email, GitHub token, OpenAI API key) will be kept local'",
    w: 1280,
    h: 800,
    cap: "A deploy script pasted into ChatGPT. Three live-looking credentials and an address, counted before the send and swapped on the way out.",
  },
  {
    id: "claude",
    tab: "On Claude",
    src: "/ss-inspector-claude.webp",
    alt: "The same inspector on Claude: a prompt addressed to three colleagues, where each real address has been replaced by a different plausible stand-in, and the pre-send count reads '3 items (Email) will be kept local (stand-ins sent instead) when you send'",
    w: 1280,
    h: 800,
    cap: "Three addresses in one prompt, each sent as its own plausible stand-in. Claude drafts against something that reads like a real email; the actual recipients never leave the tab, and come back in the reply.",
  },
  {
    id: "wire",
    tab: "On the wire",
    src: "/gemini-redaction-proof.webp",
    alt: "A Gemini chat drafting an email that contains a Swiss AHV number, beside Chrome DevTools showing the outgoing StreamGenerate request carries the placeholder [AHV_1] instead of the real number",
    w: 3040,
    h: 1678,
    cap: "DevTools on a real Gemini send: the outgoing request carries [AHV_1] eight times, never the digits. The reply you read has the real number back.",
  },
  {
    id: "controls",
    tab: "Your controls",
    src: "/ss-options.webp",
    alt: "The Sovereign Shield options page: a Guard enabled switch, a Smokescreen mode switch explaining that stand-ins apply to emails and custom terms only, and a 'What to block' grid of identifier types — Swiss AHV/AVS, IBAN, credit card, and national IDs across Europe, the Americas and Asia — each with its own checkbox",
    w: 1280,
    h: 800,
    cap: "The guard, smokescreen, and twenty identifier types each on their own toggle. Anything unchecked passes through untouched.",
  },
  {
    id: "rules",
    tab: "Your own terms",
    src: "/ss-rules-library.webp",
    alt: "Further down the options page: a 'Custom rules' section offering ready-made rules for a US Social Security number, UK National Insurance number, internal IP address, internal hostname and MAC address, above a user's own rule for a client project name, and an Activity log reading '113 identifiers kept local' broken down by type",
    w: 1280,
    h: 800,
    cap: "Ready-made rules in a click — US SSN, UK NI, internal IPs, hostnames, MACs — beside your own terms. Below them the activity log, which counts type, time and site and never the value.",
  },
];

export default function ShotTabs() {
  const [active, setActive] = useState(SHOTS[0].id);
  const shot = SHOTS.find((s) => s.id === active) ?? SHOTS[0];

  return (
    <div className="shots">
      <div className="shots-tabs" role="tablist" aria-label="Screenshots">
        {SHOTS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === active}
            aria-controls="shot-panel"
            className={`chip ${s.id === active ? "active" : ""}`}
            onClick={() => setActive(s.id)}
          >
            {s.tab}
          </button>
        ))}
      </div>
      <figure className="ext-shot" id="shot-panel" role="tabpanel">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shot.src} alt={shot.alt} width={shot.w} height={shot.h} />
        <figcaption>{shot.cap}</figcaption>
      </figure>
    </div>
  );
}
