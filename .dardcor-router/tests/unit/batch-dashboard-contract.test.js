import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("batch dashboard contract", () => {
  const client = read("src/app/(dashboard)/dashboard/batch/BatchPageClient.js");

  it("uses the authenticated delete endpoint for terminal jobs only", () => {
    expect(client).toContain('method: "DELETE"');
    expect(client).toContain("{isTerminal && (");
    expect(read("src/app/api/batches/[id]/route.js")).toContain("batchService.delete");
    expect(read("src/app/api/batches/[id]/route.js")).toContain("canAccessLocalOnlyRoute");
  });

  it("sources selectable providers only from the batch API registry", () => {
    expect(client).toContain("setRegisteredProviders(Array.isArray(data.providers) ? data.providers : [])");
    expect(client).not.toContain("for (const b of data.batches");
    expect(read("src/app/api/batches/route.js")).toContain("providers: batchService.providers()");
  });

  it("disables submission when no executor providers exist", () => {
    expect(client).toContain("disabled={noProviders}");
    expect(client).toContain("disabled={!hasProviders}");
    expect(client).toContain("No batch-capable providers are currently registered");
    expect(client).not.toContain("processed sequentially with rate-limiting");
  });

  it("gates status actions and artifact access", () => {
    expect(client).toContain('const canCancel = batch.status === "queued" || batch.status === "running"');
    expect(client).toContain('const canRetry = batch.status === "failed"');
    expect(client).toContain('if (tab.value === "results" && resultData === null && isTerminal)');
    expect(client).toContain("{isTerminal && (");
  });
});
