import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Integration test: the real standalone boot must refuse weak secrets before
// the port opens. The postbuild-installed wrapper (.next/standalone/server.js)
// calls the canonical policy first, so a weak API_KEY_SECRET, MACHINE_ID_SALT,
// or JWT_SECRET exits nonzero with no listener. 120s per-test timeout: spawn +
// boot polling exceed Vitest's 5s default.

const SERVER = fileURLToPath(new URL("../../.next/standalone/server.js", import.meta.url));

const BOOT_TIMEOUT_MS = 90_000;
const POLL_MS = 250;
const KILL_GRACE_MS = 5_000;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function tryConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1", timeout: 400 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

// Boots the real standalone server with the given env overrides, polls until it
// either exits or opens the port, and always reaps the child and temp dir.
async function runBootScenario(env) {
  const port = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "miawrouter-boot-weak-"));
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      DATA_DIR: dataDir,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let childOutput = "";
  child.stdout.on("data", (d) => (childOutput += d));
  child.stderr.on("data", (d) => (childOutput += d));

  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  let outcome = null;
  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        outcome = { kind: "exited", ...(await exited) };
        break;
      }
      if (await tryConnect(port)) {
        outcome = { kind: "listening" };
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    if (!outcome) outcome = { kind: "timeout" };
  } finally {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise((r) => child.once("close", r)),
      new Promise((r) => setTimeout(r, KILL_GRACE_MS)),
    ]);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  return { ...outcome, childOutput };
}

// Strong values here must not appear in the policy weak lists, so the other
// secrets cannot mask the one under test.
function expectBootRefused(outcome, weakLabel) {
  if (outcome.kind !== "exited") {
    throw new Error(
      `weak ${weakLabel} must make boot exit nonzero before the port opens, but server ${outcome.kind}` +
        (outcome.childOutput ? `\n--- child output (tail) ---\n${outcome.childOutput.slice(-2000)}` : ""),
    );
  }
  expect(outcome.code).not.toBe(0);
}

describe("standalone boot with weak secrets", () => {
  it("exits nonzero before the port opens when API_KEY_SECRET/MACHINE_ID_SALT are weak", async () => {
    const outcome = await runBootScenario({
      API_KEY_SECRET: "endpoint-proxy-api-key-secret",
      MACHINE_ID_SALT: "endpoint-proxy-salt",
      JWT_SECRET: "a-strong-jwt-secret-not-in-any-weak-list",
    });
    expectBootRefused(outcome, "API_KEY_SECRET/MACHINE_ID_SALT");
  }, 120_000);

  it("exits nonzero before the port opens when JWT_SECRET alone is weak", async () => {
    const outcome = await runBootScenario({
      JWT_SECRET: "change-me-to-a-long-random-secret",
      API_KEY_SECRET: "a-strong-api-key-secret-not-in-any-weak-list",
      MACHINE_ID_SALT: "a-strong-machine-salt-not-in-any-weak-list",
    });
    expectBootRefused(outcome, "JWT_SECRET");
  }, 120_000);
});
