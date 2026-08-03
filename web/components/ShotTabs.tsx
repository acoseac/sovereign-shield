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

const SHOTS: Shot[] = [
  {
    id: "pill",
    tab: "Before you send",
    src: "/ss-pill-chatgpt.png",
    alt: "The Sovereign Shield pre-send count above the ChatGPT composer, reading '3 items (Credit card, Email, Swiss AHV / AVS) will be kept local when you send'",
    w: 1280,
    h: 800,
    cap: "A live count sits above the chat box and names what stays local — before you hit send.",
  },
  {
    id: "inspect",
    tab: "Inspect it",
    src: "/ss-inspector.png",
    alt: "The Sovereign Shield inspector panel open beside a Gemini composer: a 'You typed' pane showing a client project name, an email address and a Google API key, and a 'What the provider receives' pane where the project name and email have become realistic stand-ins and the API key has become the placeholder [GOOGLE_1]",
    w: 1600,
    h: 1016,
    cap: "Your prompt beside the payload the provider actually receives, every replaced span marked. Smokescreen is on here — which is why the email and the project name became stand-ins while the API key stayed [GOOGLE_1].",
  },
  {
    id: "wire",
    tab: "On the wire",
    src: "/gemini-redaction-proof.png",
    alt: "A Gemini chat drafting an email that contains a Swiss AHV number, beside Chrome DevTools showing the outgoing StreamGenerate request carries the placeholder [AHV_1] instead of the real number",
    w: 3040,
    h: 1678,
    cap: "DevTools on a real Gemini send: the outgoing request carries [AHV_1] eight times, never the digits. The reply you read has the real number back.",
  },
  {
    id: "controls",
    tab: "Your controls",
    src: "/ss-options.png",
    alt: "The Sovereign Shield options page showing a 'What to block' grid of 20 identifier types — Swiss AHV/AVS, IBAN, credit card and national IDs across Europe, the Americas and Asia — each with its own checkbox",
    w: 1280,
    h: 800,
    cap: "Twenty identifier types, each its own toggle. Anything unchecked passes through untouched.",
  },
  {
    id: "rules",
    tab: "Secrets & your rules",
    src: "/ss-secrets-rules.png",
    alt: "Further down the same options page: a 'Secrets & API keys' group with nine toggles (AWS, Anthropic, Google, Stripe, PEM private key, OpenAI, GitHub, Slack, JWT), a 'Custom rules' editor holding a client project name with regex / case-sensitive / whole-word options, and the value-free activity log",
    w: 1530,
    h: 1628,
    cap: "Nine secret types, your own terms as text or regex, and the activity log — which records type, time and site, and never the value.",
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
