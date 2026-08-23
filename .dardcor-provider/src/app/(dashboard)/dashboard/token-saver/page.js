import TokenSaverClient from "./TokenSaverClient";
import TokenSaverStatsPanel from "../components/TokenSaverStatsPanel";

export default function TokenSaverPage() {
  return (
    <>
      <TokenSaverClient />
      <TokenSaverStatsPanel />
    </>
  );
}
