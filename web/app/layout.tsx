import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "The Sovereign AI Gateway — keep personal data in Switzerland",
  description:
    "Let your team use any LLM (Gemini, Claude, DeepSeek) while no personal data leaves Switzerland. A deterministic gateway tokenizes Swiss PII before the prompt crosses the border and restores it on the way back — running in your browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
