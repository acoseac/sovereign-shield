import Link from "next/link";

export default function Nav({ current }: { current?: "home" | "how" | "bench" }) {
  return (
    <nav className="nav">
      <Link className={current === "home" ? "active" : ""} href="/">
        Gateway
      </Link>
      <Link className={current === "how" ? "active" : ""} href="/how-it-works">
        How it works
      </Link>
      <Link className={current === "bench" ? "active" : ""} href="/benchmark">
        Benchmark
      </Link>
    </nav>
  );
}
