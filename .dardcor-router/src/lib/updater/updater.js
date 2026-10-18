
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");
const os = require("os");

const packageName = process.env.UPDATER_PKG_NAME || "dardcor-code";
const port = parseInt(process.env.UPDATER_PORT || "21129", 10);
const tailLines = parseInt(process.env.UPDATER_TAIL_LINES || "8", 10);
const maxRetries = parseInt(process.env.UPDATER_RETRIES || "3", 10);
const retryDelayMs = parseInt(process.env.UPDATER_RETRY_DELAY_MS || "5000", 10);
const lingerMs = parseInt(process.env.UPDATER_LINGER_MS || "30000", 10);
const waitMinMs = parseInt(process.env.UPDATER_WAIT_MIN_MS || "3000", 10);
const waitMaxMs = parseInt(process.env.UPDATER_WAIT_MAX_MS || "15000", 10);
const waitCheckMs = parseInt(process.env.UPDATER_WAIT_CHECK_MS || "500", 10);
const appPort = parseInt(process.env.UPDATER_APP_PORT || "21128", 10);

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "dardcor-code");
  }
  return path.join(os.homedir(), ".dardcor-code");
}
const updateDir = path.join(getDataDir(), "update");
try { fs.mkdirSync(updateDir, { recursive: true }); } catch { }
const statusFile = path.join(updateDir, "status.json");
const logFile = path.join(updateDir, "install.log");

const state = {
  phase: "starting",
  packageName,
  startedAt: Date.now(),
  finishedAt: null,
  attempt: 0,
  maxRetries,
  done: false,
  success: false,
  exitCode: null,
  error: null,
  logTail: [],
};

function pushLog(line) {
  const trimmed = line.replace(/\r?\n$/, "");
  if (!trimmed) return;
  state.logTail.push(trimmed);
  if (state.logTail.length > tailLines) state.logTail = state.logTail.slice(-tailLines);
  try { fs.appendFileSync(logFile, `${trimmed}\n`); } catch { }
}

function persistStatus() {
  try { fs.writeFileSync(statusFile, JSON.stringify(state, null, 2)); } catch { }
}

function setPhase(phase) {
  state.phase = phase;
  persistStatus();
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/update/status" || req.url === "/") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(state));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

server.on("error", (e) => {
  state.error = `status server error: ${e.message}`;
  persistStatus();
});

server.listen(port, "127.0.0.1", () => {
  persistStatus();
  waitForAppExit().then(runInstall);
});

function isAppPortBusy() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(appPort, "127.0.0.1");
  });
}

async function waitForAppExit() {
  setPhase("waitingForExit");
  pushLog(`[updater] waiting for app to exit (min ${Math.round(waitMinMs / 1000)}s)...`);

  await sleep(waitMinMs);

  const deadline = Date.now() + (waitMaxMs - waitMinMs);
  while (Date.now() < deadline) {
    const busy = await isAppPortBusy();
    if (!busy) {
      pushLog(`[updater] app port :${appPort} is free, proceeding`);
      return;
    }
    await sleep(waitCheckMs);
  }
  pushLog(`[updater] timeout waiting for app, proceeding anyway`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runInstall() {
  state.attempt += 1;
  setPhase("installing");
  pushLog(`[updater] attempt ${state.attempt}/${maxRetries} — npm i -g ${packageName} --prefer-online`);

  const isWin = process.platform === "win32";
  const cmd = isWin ? "npm.cmd" : "npm";
  const args = ["i", "-g", packageName, "--prefer-online"];

  const child = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: isWin,
  });

  child.stdout.on("data", (buf) => {
    buf.toString().split(/\r?\n/).forEach(pushLog);
    persistStatus();
  });
  child.stderr.on("data", (buf) => {
    buf.toString().split(/\r?\n/).forEach(pushLog);
    persistStatus();
  });

  child.on("error", (e) => {
    pushLog(`[updater] spawn error: ${e.message}`);
    finalize(false, null, e.message);
  });

  child.on("close", (code) => {
    pushLog(`[updater] npm exited with code ${code}`);
    if (code === 0) {
      finalize(true, code, null);
      return;
    }
    if (state.attempt < maxRetries) {
      pushLog(`[updater] retrying in ${Math.round(retryDelayMs / 1000)}s...`);
      setTimeout(runInstall, retryDelayMs);
      return;
    }
    finalize(false, code, `Install failed after ${maxRetries} attempts`);
  });
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? `open "${url}"`
    : platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  try { spawn(cmd, { shell: true, detached: true, stdio: "ignore" }).unref(); } catch { }
}

async function waitForAppAndOpenBrowser() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const busy = await isAppPortBusy();
    if (busy) {
      openBrowser(`http://localhost:${appPort}/dashboard`);
      pushLog(`[updater] app ready, opened dashboard`);
      return;
    }
    await sleep(1000);
  }
  pushLog(`[updater] app not responding within 30s, skip browser open`);
}

function relaunchApp() {
  if (process.env.UPDATER_RELAUNCH !== "1") return;
  const cmd = process.env.UPDATER_RELAUNCH_CMD;
  if (!cmd) return;
  let args = [];
  try { args = JSON.parse(process.env.UPDATER_RELAUNCH_ARGS || "[]"); } catch { }
  const isWin = process.platform === "win32";
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: isWin,
      env: { ...process.env, UPDATER_RELAUNCH: "", UPDATER_RELAUNCH_CMD: "", UPDATER_RELAUNCH_ARGS: "" },
    });
    child.unref();
    pushLog(`[updater] relaunched: ${cmd} ${args.join(" ")} (pid=${child.pid})`);
    waitForAppAndOpenBrowser();
  } catch (e) {
    pushLog(`[updater] relaunch failed: ${e.message}`);
  }
}

function finalize(success, exitCode, error) {
  state.done = true;
  state.success = success;
  state.exitCode = exitCode;
  state.error = error;
  state.finishedAt = Date.now();
  setPhase(success ? "done" : "error");
  if (success) relaunchApp();
  setTimeout(() => {
    try { server.close(); } catch { }
    process.exit(success ? 0 : 1);
  }, lingerMs);
}
