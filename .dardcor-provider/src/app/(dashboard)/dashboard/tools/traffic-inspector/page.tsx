import { TrafficInspectorPageClient } from "./TrafficInspectorPageClient";

export const metadata = {
  title: "Traffic Inspector — DardcorCode",
  description: "Monitor LLM calls + debug any application's HTTPS traffic",
};

export default function TrafficInspectorPage() {
  return <TrafficInspectorPageClient />;
}
