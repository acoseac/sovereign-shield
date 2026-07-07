import Gateway from "@/components/Gateway";
import { isPersistent, readStats } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const stats = await readStats();
  return <Gateway initialStats={stats} persistent={isPersistent} />;
}
