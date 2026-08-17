import { getMachineId } from "@/shared/utils/machine";
import HomePageClient from "../dashboard/HomePageClient";
import BootstrapBanner from "../dashboard/BootstrapBanner";
import KimiSponsorBanner from "../dashboard/KimiSponsorBanner";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const machineId = await getMachineId();
  const isBootstrapped = process.env.OMNIROUTE_BOOTSTRAPPED === "true";
  return (
    <>
      {isBootstrapped && <BootstrapBanner />}
      <KimiSponsorBanner />
      <HomePageClient machineId={machineId} />
    </>
  );
}
