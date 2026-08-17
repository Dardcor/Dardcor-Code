import { getMachineId } from "@/shared/utils/machine";
import HomePageClient from "./HomePageClient";
import BootstrapBanner from "./BootstrapBanner";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const machineId = await getMachineId();
  const isBootstrapped = process.env.OMNIROUTE_BOOTSTRAPPED === "true";
  return (
    <>
      {isBootstrapped && <BootstrapBanner />}
      <HomePageClient machineId={machineId} />
    </>
  );
}
