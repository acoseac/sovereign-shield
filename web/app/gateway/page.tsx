import type { Metadata } from "next";

import Gateway from "@/components/Gateway";
import { isPersistent, readStats } from "@/lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The Sovereign Gateway — use any LLM while no personal data leaves Switzerland",
  description:
    "Watch a Swiss document get tokenized on the way out and restored on the way back, live in your browser. The same deterministic boundary as the extension, run as a proxy in front of your own app.",
};

export default async function Page() {
  const stats = await readStats();
  return <Gateway initialStats={stats} persistent={isPersistent} />;
}
