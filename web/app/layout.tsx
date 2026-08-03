import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Sovereign Shield — keep personal data out of the LLM you're using",
  description:
    "A deterministic, open-source guard for LLM traffic: a Chrome extension for ChatGPT, Gemini and Claude, and a gateway for your own app. Identifiers, API keys and your own terms are replaced with placeholders before the prompt leaves, and restored on the way back.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
