import Link from "next/link";

export default function Nav({
  current,
}: {
  current?: "home" | "how" | "bench" | "scan" | "ext" | "gov";
}) {
  return (
    <nav className="nav">
      <Link className={current === "home" ? "active" : ""} href="/">
        Gateway
      </Link>
      <Link className={current === "ext" ? "active" : ""} href="/extension">
        Extension
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
