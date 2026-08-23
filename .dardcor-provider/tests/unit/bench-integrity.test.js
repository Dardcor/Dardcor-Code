/**
 * tests/unit/bench-integrity.test.js — Phase 9 focused unit test for the
 * cache-prefix integrity check in bench/integrity.js: the L0 begin/finish
 * contract, structural region hashing, per-turn byte identity, and cross-turn
 * stability / tail-only churn for the cache-integrity fixture.
 *
 * Written but intentionally NOT run in this phase; the runner executes it.
 * The fixture body is synthetic; the `replay` hook is injected, so no real
 * pipeline and no network is touched.
 */

import { describe, it, expect } from "vitest";
import {
  sha256Json, extractRegions, regionHashes, regionKeyForName,
  checkTurnIntegrity, checkFixtureIntegrity, buildL0Input,
} from "../../bench/integrity.js";

const CONFIG = { id: "all-on", stream: true, settings: { rtkEnabled: true } };

// A minimal cache-integrity-shaped fixture: stable system/tools/spec, tail churns.
function makeFixture({ turns }) {
  return {
    schema: "miaw-bench-fixture/1",
    id: "cache-integrity",
    expect: {
      byteIdenticalPrefix: true,
      stableRegions: ["system", "tools", "t1 spec document"],
      turnWithFullStablePrefix: ["t2", "t3"],
    },
    turns,
  };
}

function turnBody(extraUser = "Question 1") {
  return {
    model: "mock/gpt-5-mini",
    temperature: 0,
    tools: [{ type: "function", function: { name: "submit_order", description: "order", parameters: { type: "object", properties: {} } } }],
    messages: [
      { role: "system", content: "You are the migration architect. The frozen spec is contractual." },
      { role: "user", content: "FROZEN SPEC (v2.3) — section 4 refunds full-order only." },
      { role: "user", content: extraUser },
    ],
  };
}

// A replay that returns the SAME body the check passes it (identity pipeline)
// or a mutated one.
const identityReplay = async (body) => ({ ok: true, error: null, outboundBody: structuredClone(body), events: [] });
const mutateToolsReplay = (body) => async () => {
  const outbound = structuredClone(body);
  outbound.tools[0].function.name = "MUTATED"; // compress/translate mutated a protected region
  return { ok: true, error: null, outboundBody: outbound, events: [] };
};

describe("bench/integrity.js pure helpers", () => {
  it("sha256Json matches the L0 contentHash convention (sha256 of JSON.stringify)", () => {
    expect(sha256Json("abc")).toBe(sha256Json("abc"));
    expect(sha256Json({ a: 1 })).not.toBe(sha256Json({ a: 2 }));
    expect(sha256Json(null)).toBe(sha256Json(undefined)); // both serialize to null
    expect(sha256Json("abc")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("extractRegions finds system/tools/spec/prefix/last structurally", () => {
    const r = extractRegions(turnBody());
    expect(r.system.role).toBe("system");
    expect(Array.isArray(r.tools)).toBe(true);
    expect(r.spec.content).toContain("FROZEN SPEC");
    expect(r.prefix.length).toBe(2); // messages minus last
    expect(r.last.content).toBe("Question 1");
  });

  it("regionKeyForName maps fixture region names to structural keys", () => {
    expect(regionKeyForName("system")).toBe("system");
    expect(regionKeyForName("tools")).toBe("tools");
    expect(regionKeyForName("t1 spec document")).toBe("spec");
    expect(regionKeyForName("garbage")).toBe(null);
  });
});

describe("bench/integrity.js buildL0Input (chatCore L0 snapshot point)", () => {
  // Written but intentionally NOT run in this phase; the runner executes it.
  it("clones the request and applies enabled injectors at harness default levels without mutating the original", () => {
    const body = turnBody();
    const before = structuredClone(body);
    const injected = buildL0Input(body, { settings: { cavemanEnabled: true, ponytailEnabled: true } });
    expect(injected).not.toBe(body); // clone, never the raw request
    expect(body).toEqual(before); // original untouched — replay still gets it raw
    expect(injected.messages[0].content).toContain(before.messages[0].content); // appended, not replaced
    expect(injected.messages[0].content).not.toBe(before.messages[0].content); // injection happened
    // Default levels mirror harness settingsFromConfig: level || "full".
    const explicitFull = buildL0Input(body, { settings: { cavemanEnabled: true, ponytailEnabled: true, cavemanLevel: "full", ponytailLevel: "full" } });
    expect(injected.messages[0].content).toBe(explicitFull.messages[0].content);
    // Disabled injectors leave the clone byte-identical to the request.
    expect(buildL0Input(body, { settings: {} })).toEqual(before);
  });

  it("aligns checkTurnIntegrity's L0 snapshot with chatCore's post-injection point", async () => {
    const body = turnBody();
    const cfg = { id: "injectors", settings: { cavemanEnabled: true, ponytailEnabled: true } };
    // Simulate chatCore: the replay receives the RAW fixture request and
    // applies the enabled injectors itself (exactly once), returning the
    // injected body as the outbound capture.
    const replay = async (rawBody) => {
      expect(rawBody.messages[0].content).toBe(body.messages[0].content); // raw, not pre-injected
      const outbound = buildL0Input(rawBody, cfg); // same injector defaults chatCore uses
      return { ok: true, error: null, outboundBody: outbound, events: [] };
    };
    const res = await checkTurnIntegrity({ turn: { id: "t1", request: body }, fixture: makeFixture({ turns: [{ id: "t1", request: body }] }), config: cfg, replay });
    expect(res.inconclusive).toBe(null);
    expect(res.passed).toBe(true);
    const system = res.regions.find((r) => r.name === "system");
    expect(system.identical).toBe(true); // before (injected snapshot) === after (injected outbound)
  });
});

describe("bench/integrity.js checkTurnIntegrity", () => {
  it("passes when the pipeline leaves every protected region byte-identical", async () => {
    const body = turnBody();
    const res = await checkTurnIntegrity({ turn: { id: "t1", request: body }, fixture: makeFixture({ turns: [{ id: "t1", request: body }] }), config: CONFIG, replay: identityReplay });
    expect(res.inconclusive).toBe(null);
    expect(res.passed).toBe(true);
    expect(res.regions.length).toBeGreaterThan(0);
    expect(res.regions.every((r) => r.identical === true)).toBe(true);
    expect(res.restored).toBe(false);
  });

  it("passes when a short prefix (t1) omits a region from the snapshot but the inbound fallback still proves identity", async () => {
    // messages = [system, userQ] → L0 prefix is [system]; the spec region is
    // absent from the snapshot and must fall back to the inbound structural hash.
    const body = {
      model: "mock/gpt-5-mini",
      messages: [
        { role: "system", content: "architect" },
        { role: "user", content: "FROZEN SPEC v2.3 — section 4." },
      ],
    };
    const fixture = makeFixture({ turns: [{ id: "t1", request: body }] });
    const res = await checkTurnIntegrity({ turn: { id: "t1", request: body }, fixture, config: CONFIG, replay: identityReplay });
    expect(res.inconclusive).toBe(null);
    expect(res.passed).toBe(true);
    const spec = res.regions.find((r) => r.name === "t1 spec document");
    expect(spec.identical).toBe(true);
    expect(spec.note).toBeUndefined();
  });

  it("fails when a protected region is mutated through the pipeline", async () => {
    const body = turnBody();
    const res = await checkTurnIntegrity({ turn: { id: "t1", request: body }, fixture: makeFixture({ turns: [{ id: "t1", request: body }] }), config: CONFIG, replay: mutateToolsReplay(body) });
    expect(res.passed).toBe(false);
    const tools = res.regions.find((r) => r.name === "tools");
    expect(tools.identical).toBe(false);
  });

  it("is inconclusive (a failure, not a pass) when no outbound body is captured", async () => {
    const body = turnBody();
    const res = await checkTurnIntegrity({
      turn: { id: "t1", request: body },
      fixture: makeFixture({ turns: [{ id: "t1", request: body }] }),
      config: CONFIG,
      replay: async () => ({ ok: true, error: null, outboundBody: null, events: [] }),
    });
    expect(res.inconclusive).toContain("no outbound body captured");
    expect(res.passed).toBe(false);
  });

  it("is inconclusive when the pipeline fails", async () => {
    const body = turnBody();
    const res = await checkTurnIntegrity({
      turn: { id: "t1", request: body },
      fixture: makeFixture({ turns: [{ id: "t1", request: body }] }),
      config: CONFIG,
      replay: async () => ({ ok: false, error: "boom", outboundBody: null, events: [] }),
    });
    expect(res.inconclusive).toContain("pipeline failed");
    expect(res.passed).toBe(false);
  });

  it("is inconclusive when L0 cannot orchestrate (no messages[] shape)", async () => {
    const res = await checkTurnIntegrity({
      turn: { id: "t1", request: { model: "mock/x" } }, // no messages
      fixture: makeFixture({ turns: [{ id: "t1", request: { model: "mock/x" } }] }),
      config: CONFIG,
      replay: async () => ({ ok: true, error: null, outboundBody: { model: "mock/x" }, events: [] }),
    });
    expect(res.inconclusive).toContain("l0.begin returned null");
    expect(res.passed).toBe(false);
  });
});

describe("bench/integrity.js checkFixtureIntegrity", () => {
  it("passes with byte-identical stable regions and tail-only churn across full-prefix turns", async () => {
    const t1 = turnBody("Question 1");
    const t2 = turnBody("Question 1"); // identical prefix; new tail
    const t3 = turnBody("Question 2"); // same prefix, tail churns
    delete t2.tools; delete t3.tools; // full-prefix turns never carry tools → region verdict must be null
    const fixture = makeFixture({ turns: [{ id: "t1", request: t1 }, { id: "t2", request: t2 }, { id: "t3", request: t3 }] });
    const res = await checkFixtureIntegrity({
      fixture,
      config: CONFIG,
      replay: identityReplay, // identity pipeline per turn
    });
    expect(res.passed).toBe(true);
    expect(res.turns.every((t) => t.passed)).toBe(true);
    expect(res.crossTurn.stable).toBe(true);
    expect(res.crossTurn.tailOnlyChurn).toBe(true);
    expect(res.crossTurn.regions.system).toBe(true); // observed & stable
    expect(res.crossTurn.regions.tools).toBe(null); // never observed across full-prefix turns
    expect(res.restored).toBe(false);
  });

  it("fails when a stable region mutates between full-prefix turns", async () => {
    const t1 = turnBody("Question 1");
    const t2 = turnBody("Question 1");
    const fixture = makeFixture({ turns: [{ id: "t1", request: t1 }, { id: "t2", request: t2 }] });
    let mutated = false; // only the FIRST turn's outbound is tampered
    const res = await checkFixtureIntegrity({
      fixture,
      config: CONFIG,
      replay: async (body) => {
        const outbound = structuredClone(body);
        if (!mutated) {
          mutated = true;
          outbound.messages[0].content += " tampered"; // system region mutated once
        }
        return { ok: true, error: null, outboundBody: outbound, events: [] };
      },
    });
    expect(res.crossTurn.stable).toBe(false); // t1 ≠ t2 system bytes
    expect(res.passed).toBe(false);
  });
});
