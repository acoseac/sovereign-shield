"use client";

import { useEffect, useRef, useState } from "react";

/** Copy button for one preset code. The clipboard is the entire transport into the
 *  extension — there is deliberately no deep link or message channel to it. */
export default function PresetCopy({ code }: Readonly<{ code: string }>) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      className="preset-copy"
      onClick={() => {
        // Absent outside secure contexts — degrade to a no-op rather than a throwing handler.
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1600);
        }, () => undefined);
      }}
    >
      {copied ? "Copied ✓" : "Copy preset code"}
    </button>
  );
}
