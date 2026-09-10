import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Sovereign Shield — keep personal data out of the LLM you're using",
  description:
    "A deterministic, open-source guard for LLM traffic: a Chrome extension for ChatGPT, Gemini and Claude, and a gateway for your own app. Identifiers, API keys and your own terms are replaced with placeholders before the prompt leaves, and restored on the way back.",
};

// The project was frozen in September 2026. The published extension hard-wires this host
// (manifest `homepage_url`, the options page's presets link, the store's privacy-policy URL),
// so the site stays up exactly as it was — this notice is the one thing added to every page.
const README_URL = "https://github.com/acoseac/sovereign-shield#readme";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="frozen" role="note">
          <p className="frozen-in">
            <strong>Sovereign Shield is no longer maintained (frozen September 2026).</strong> The
            extension keeps working as-is but will not be updated, not even for security fixes.{" "}
            <a href={README_URL} target="_blank" rel="noreferrer">
              Details in the README on GitHub
            </a>
            .
          </p>
        </div>
        {children}
      </body>
    </html>
  );
}
