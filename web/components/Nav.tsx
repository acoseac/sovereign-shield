import Link from "next/link";

export default function Nav({
  current,
}: {
  current?: "ext" | "gateway" | "how" | "bench" | "scan" | "gov";
}) {
  return (
    <nav className="nav">
      <Link className={current === "ext" ? "active" : ""} href="/">
        Extension
      </Link>
      <Link className={current === "gateway" ? "active" : ""} href="/gateway">
        Gateway
      </Link>
      <Link className={current === "scan" ? "active" : ""} href="/scan">
        Leak Radar
      </Link>
      <Link className={current === "how" ? "active" : ""} href="/how-it-works">
        How it works
      </Link>
      <Link className={current === "bench" ? "active" : ""} href="/benchmark">
        Benchmark
      </Link>
      <Link className={current === "gov" ? "active" : ""} href="/governance">
        Governance
      </Link>
      <a className="nav-home" href="https://www.ars.md/">
        ← ars.md
      </a>
    </nav>
  );
}
