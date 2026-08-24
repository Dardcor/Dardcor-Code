import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { copyStandaloneAssets } from "../../scripts/copy-standalone-assets.mjs";

const fixtures = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function createBuildFixture(distDir) {
  const projectRoot = mkdtempSync(join(tmpdir(), "dardcor-code-standalone-assets-"));
  fixtures.push(projectRoot);
  const buildRoot = join(projectRoot, distDir);
  mkdirSync(join(buildRoot, "standalone"), { recursive: true });
  mkdirSync(join(buildRoot, "static", "chunks"), { recursive: true });
  mkdirSync(join(projectRoot, "public"), { recursive: true });
  writeFileSync(join(buildRoot, "static", "chunks", "app.js"), "static asset");
  writeFileSync(join(projectRoot, "public", "favicon.svg"), "public asset");
  return projectRoot;
}

describe("standalone build assets", () => {
  it("copies static and public assets into the default standalone layout", () => {
    const projectRoot = createBuildFixture(".next");

    copyStandaloneAssets({ projectRoot, distDir: ".next" });

    expect(readFileSync(join(projectRoot, ".next", "standalone", ".next", "static", "chunks", "app.js"), "utf8"))
      .toBe("static asset");
    expect(readFileSync(join(projectRoot, ".next", "standalone", "public", "favicon.svg"), "utf8"))
      .toBe("public asset");
  });

  it("uses a custom Next dist directory", () => {
    const projectRoot = createBuildFixture(".next-cli-build");

    copyStandaloneAssets({ projectRoot, distDir: ".next-cli-build" });

    expect(readFileSync(join(projectRoot, ".next-cli-build", "standalone", ".next-cli-build", "static", "chunks", "app.js"), "utf8"))
      .toBe("static asset");
  });

  it("does not modify workspace-traced CLI builds", () => {
    const projectRoot = createBuildFixture(".next-cli-build");
    const previousMode = process.env.NEXT_TRACING_ROOT_MODE;
    process.env.NEXT_TRACING_ROOT_MODE = "workspace";

    try {
      copyStandaloneAssets({ projectRoot, distDir: ".next-cli-build" });
    } finally {
      if (previousMode === undefined) delete process.env.NEXT_TRACING_ROOT_MODE;
      else process.env.NEXT_TRACING_ROOT_MODE = previousMode;
    }

    expect(() => readFileSync(join(projectRoot, ".next-cli-build", "standalone", ".next-cli-build", "static", "chunks", "app.js")))
      .toThrow();
  });
});

const GATE_MARK = 'require("./secret-policy.cjs").assertNoWeakSecrets()';

function createGateFixture(distDir) {
  const projectRoot = createBuildFixture(distDir);
  writeFileSync(join(projectRoot, "secret-policy.cjs"), "// fake root policy\nmodule.exports = {};\n");
  writeFileSync(join(projectRoot, distDir, "standalone", "server.js"), "// real generated server\nconsole.log('real');\n");
  return projectRoot;
}

describe("standalone weak-secret gate wrapper", () => {
  it("wraps the generated server.js with the weak-secret gate", () => {
    const projectRoot = createGateFixture(".next");

    copyStandaloneAssets({ projectRoot, distDir: ".next" });

    const server = readFileSync(join(projectRoot, ".next", "standalone", "server.js"), "utf8");
    expect(server).toContain(GATE_MARK);
    expect(server).toContain('require("./next-server.js")');
    expect(readFileSync(join(projectRoot, ".next", "standalone", "next-server.js"), "utf8"))
      .toBe("// real generated server\nconsole.log('real');\n");
    expect(readFileSync(join(projectRoot, ".next", "standalone", "secret-policy.cjs"), "utf8"))
      .toBe("// fake root policy\nmodule.exports = {};\n");
  });

  it("is idempotent across repeated postbuild runs", () => {
    const projectRoot = createGateFixture(".next");

    copyStandaloneAssets({ projectRoot, distDir: ".next" });
    const wrappedOnce = readFileSync(join(projectRoot, ".next", "standalone", "server.js"), "utf8");

    copyStandaloneAssets({ projectRoot, distDir: ".next" });
    const wrappedTwice = readFileSync(join(projectRoot, ".next", "standalone", "server.js"), "utf8");

    expect(wrappedTwice).toBe(wrappedOnce);
    expect(readFileSync(join(projectRoot, ".next", "standalone", "next-server.js"), "utf8"))
      .toBe("// real generated server\nconsole.log('real');\n");
  });

  it("re-wraps a freshly regenerated server.js and replaces stale next-server.js", () => {
    const projectRoot = createGateFixture(".next");

    copyStandaloneAssets({ projectRoot, distDir: ".next" });

    // A fresh Next build regenerated the real server over our wrapper.
    writeFileSync(join(projectRoot, ".next", "standalone", "server.js"), "// fresh real server\n");
    copyStandaloneAssets({ projectRoot, distDir: ".next" });

    expect(readFileSync(join(projectRoot, ".next", "standalone", "server.js"), "utf8")).toContain(GATE_MARK);
    expect(readFileSync(join(projectRoot, ".next", "standalone", "next-server.js"), "utf8")).toBe("// fresh real server\n");
  });

  it("wraps the nested workspace-traced CLI standalone too", () => {
    const projectRoot = createBuildFixture(".next-cli-build");
    mkdirSync(join(projectRoot, ".next-cli-build", "standalone", "dardcor-code"), { recursive: true });
    writeFileSync(join(projectRoot, "secret-policy.cjs"), "// fake root policy\nmodule.exports = {};\n");
    writeFileSync(join(projectRoot, ".next-cli-build", "standalone", "dardcor-code", "server.js"), "// cli real server\n");

    copyStandaloneAssets({ projectRoot, distDir: ".next-cli-build" });

    expect(readFileSync(join(projectRoot, ".next-cli-build", "standalone", "dardcor-code", "server.js"), "utf8"))
      .toContain(GATE_MARK);
    expect(readFileSync(join(projectRoot, ".next-cli-build", "standalone", "dardcor-code", "next-server.js"), "utf8"))
      .toBe("// cli real server\n");
  });

  it("refuses a standalone server without the root policy", () => {
    const projectRoot = createBuildFixture(".next");
    writeFileSync(join(projectRoot, ".next", "standalone", "server.js"), "// real server\n");

    expect(() => copyStandaloneAssets({ projectRoot, distDir: ".next" }))
      .toThrow(/secret-policy\.cjs/);
  });

  it("refuses a root policy without a standalone server", () => {
    const projectRoot = createBuildFixture(".next");
    writeFileSync(join(projectRoot, "secret-policy.cjs"), "// fake root policy\nmodule.exports = {};\n");

    expect(() => copyStandaloneAssets({ projectRoot, distDir: ".next" }))
      .toThrow(/server\.js/);
  });
});
