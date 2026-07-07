import { NextResponse } from "next/server";

import { gateway } from "@/lib/gateway";
import { isPersistent, readStats, recordProcessed } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ stats: await readStats(), persistent: isPersistent });
}

export async function POST(req: Request) {
  let body: { docId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const doc = gateway.documents.find((d) => d.id === body.docId);
  if (!doc) return NextResponse.json({ error: "unknown document" }, { status: 400 });
  // Count is recomputed server-side from the corpus so it can't be spoofed.
  await recordProcessed(doc.entities.map((e) => e.category));
  return NextResponse.json({ ok: true, stats: await readStats(), persistent: isPersistent });
}
