const { exec, spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const https = require("https");
const crypto = require("crypto");
const { addDNSEntry, removeDNSEntry, removeAllDNSEntries, removeAllDNSEntriesSync, checkAllDNSStatus, TOOL_HOSTS, isSudoAvailable, isSudoPasswordRequired } = require("./dns/dnsConfig");
const { isAdmin } = require("./winElevated.js");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const { generateCert } = require("./cert/generate");
const { installCert, uninstallCert } = require("./cert/install");
const { isCertExpired } = require("./cert/rootCA");
const { DATA_DIR, MITM_DIR } = require("./paths");
const { log, err } = require("./logger");
const { LSOF_BIN } = require("./config");

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:21128";

function shellQuoteSingle(str) {
  if (str == null || str === "") return "''";
  return `'${String(str).replace(/'/g, "'\\''")}'`;
}

async function resolveMitmRouterBaseUrl() {
  if (!_getSettings) return DEFAULT_MITM_ROUTER_BASE;
  try {
    const s = await _getSettings();
    const raw = s && s.mitmRouterBaseUrl != null ? String(s.mitmRouterBaseUrl).trim() : "";
    if (!raw) return DEFAULT_MITM_ROUTER_BASE;
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return DEFAULT_MITM_ROUTER_BASE;
    return raw.replace(/\/+$/, "");
  } catch {
    return DEFAULT_MITM_ROUTER_BASE;
  }
}

const MITM_PORT = 443;
const MITM_WIN_NODE_PORT = 8443;
const PID_FILE = path.join(MITM_DIR, ".mitm.pid");
const LOCK_FILE = path.join(MITM_DIR, ".mitm.lock");

const MITM_MAX_RESTARTS = 5;
const MITM_RESTART_DELAYS_MS = [5000, 10000, 20000, 30000, 60000];
const MITM_RESTART_RESET_MS = 60000;

let mitmRestartCount = 0;
let mitmLastStartTime = 0;
let mitmIsRestarting = false;

function resolveBundledServerPath() {
  if (process.env.MITM_SERVER_PATH) return process.env.MITM_SERVER_PATH;
  const sibling = path.join(__dirname, "server.js");
  if (fs.existsSync(sibling)) return sibling;
  const fromCwd = path.join(process.cwd(), "src", "mitm", "server.js");
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromNext = path.join(process.cwd(), "..", "src", "mitm", "server.js");
  if (fs.existsSync(fromNext)) return fromNext;
  return fromCwd;
}

function ensureRuntimeServer(bundledPath) {
  try {
    if (!bundledPath || !fs.existsSync(bundledPath)) return bundledPath;

    if (!bundledPath.includes(`${path.sep}node_modules${path.sep}`)) {
      return bundledPath;
    }

    const runtimeDir = path.join(DATA_DIR, "runtime", "mitm");
    const runtimeServer = path.join(runtimeDir, "server.js");

    if (fs.existsSync(runtimeServer)) {
      try {
        if (fs.statSync(bundledPath).size === fs.statSync(runtimeServer).size) return runtimeServer;
      } catch { }
    }

    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.copyFileSync(bundledPath, runtimeServer);
    return runtimeServer;
  } catch (e) {
    try { log(`[MITM] runtime copy failed: ${e.message}`); } catch { }
    return bundledPath;
  }
}

const SERVER_PATH = ensureRuntimeServer(resolveBundledServerPath());
const ENCRYPT_ALGO = "aes-256-gcm";
const ENCRYPT_SALT = "dardcor-code-mitm-pwd";

function getProcessUsingPort443() {
  try {
    if (IS_WIN) {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command ` +
        `"$c = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess } else { 0 }"`;
      const pidStr = execSync(psCmd, { encoding: "utf8", windowsHide: true }).trim();
      const pid = parseInt(pidStr, 10);
      if (pid && pid > 4) {
        const tasklistResult = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: "utf8", windowsHide: true });
        const processMatch = tasklistResult.match(/"([^"]+)"/);
        if (processMatch) return processMatch[1].replace(".exe", "");
      }
    } else {
      const result = execSync(`${LSOF_BIN} -i :443`, { encoding: "utf8", windowsHide: true });
      const lines = result.trim().split("\n");
      if (lines.length > 1) return lines[1].split(/\s+/)[0];
    }
  } catch {
    return null;
  }
  return null;
}

let serverProcess = null;
let serverPid = null;

function getCachedPassword() { return globalThis.__mitmSudoPassword || null; }
function setCachedPassword(pwd) { globalThis.__mitmSudoPassword = pwd; }

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EACCES";
  }
}

function killProcess(pid, force = false, sudoPassword = null) {
  if (IS_WIN) {
    const flag = force ? "/F " : "";
    exec(`taskkill ${flag}/PID ${pid}`, { windowsHide: true }, () => { });
  } else {
    const sig = force ? "SIGKILL" : "SIGTERM";
    const cmd = `pkill -${sig} -P ${pid} 2>/dev/null; kill -${sig} ${pid} 2>/dev/null`;
    if (sudoPassword || isSudoAvailable()) {
      const { execWithPassword } = require("./dns/dnsConfig");
      execWithPassword(cmd, sudoPassword || "").catch(() => exec(cmd, { windowsHide: true }, () => { }));
    } else {
      exec(cmd, { windowsHide: true }, () => { });
    }
  }
}

function deriveKey() {
  try {
    const { machineIdSync } = require("node-machine-id");
    const raw = machineIdSync();
    return crypto.createHash("sha256").update(raw + ENCRYPT_SALT).digest();
  } catch {
    return crypto.createHash("sha256").update(ENCRYPT_SALT).digest();
  }
}

function encryptPassword(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPT_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptPassword(stored) {
  try {
    const [ivHex, tagHex, dataHex] = stored.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ENCRYPT_ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(dataHex, "hex")) + decipher.final("utf8");
  } catch {
    return null;
  }
}

let _getSettings = null;
let _updateSettings = null;

function initDbHooks(getSettingsFn, updateSettingsFn) {
  _getSettings = getSettingsFn;
  _updateSettings = updateSettingsFn;
}

async function saveMitmSettings(enabled, password) {
  if (!_updateSettings) return;
  try {
    const updates = { mitmEnabled: enabled };
    if (password) updates.mitmSudoEncrypted = encryptPassword(password);
    await _updateSettings(updates);
  } catch (e) {
    err(`Failed to save settings: ${e.message}`);
  }
}

async function clearEncryptedPassword() {
  if (!_updateSettings) return;
  try {
    await _updateSettings({ mitmSudoEncrypted: null });
  } catch (e) {
    err(`Failed to clear encrypted password: ${e.message}`);
  }
}

async function loadEncryptedPassword() {
  if (!_getSettings) return null;
  try {
    const settings = await _getSettings();
    if (!settings.mitmSudoEncrypted) return null;
    return decryptPassword(settings.mitmSudoEncrypted);
  } catch {
    return null;
  }
}

async function saveDnsToolState(tool, enabled) {
  if (!_updateSettings || !_getSettings) return;
  try {
    const s = await _getSettings();
    const next = { ...(s.dnsToolEnabled || {}), [tool]: enabled };
    await _updateSettings({ dnsToolEnabled: next });
  } catch (e) {
    err(`Failed to save DNS state: ${e.message}`);
  }
}

async function loadDnsToolState() {
  if (!_getSettings) return {};
  try {
    const s = await _getSettings();
    return s.dnsToolEnabled || {};
  } catch {
    return {};
  }
}

async function restoreToolDNS(sudoPassword) {
  const state = await loadDnsToolState();
  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  for (const [tool, enabled] of Object.entries(state)) {
    if (!enabled || !TOOL_HOSTS[tool]) continue;
    try {
      await addDNSEntry(tool, password);
    } catch (e) {
      err(`DNS ${tool}: restore failed — ${e.message}`);
    }
  }
}

async function hasDnsPrivilege() {
  if (IS_WIN) return isAdmin();
  if (isAdmin()) return true;
  if (!isSudoPasswordRequired()) return true;
  const pwd = getCachedPassword() || await loadEncryptedPassword();
  return !!pwd;
}

function checkPort443Free() {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", (err) => {
      if (err.code === "EADDRINUSE") resolve("in-use");
      else resolve("no-permission");
    });
    tester.once("listening", () => { tester.close(() => resolve("free")); });
    tester.listen(MITM_PORT, "127.0.0.1");
  });
}

function getPort443Owner(sudoPassword) {
  return new Promise((resolve) => {
    if (IS_WIN) {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "` +
        `$c = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
        `if ($c) { $c.OwningProcess } else { 0 }"`;    
      exec(psCmd, { windowsHide: true }, (err, stdout) => {
        if (err) return resolve(null);
        const pid = parseInt(stdout.trim(), 10);
        if (!pid || pid <= 4) return resolve(null);
        exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { windowsHide: true }, (e2, out2) => {
          const m = out2?.match(/"([^"]+)"/);
          resolve({ pid, name: m ? m[1] : "unknown" });
        });
      });
    } else {
      exec(`${LSOF_BIN} -nP -iTCP:443 -sTCP:LISTEN -t`, { windowsHide: true }, (err, stdout) => {
        if (err || !stdout?.trim()) return resolve(null);
        const pid = parseInt(stdout.trim().split("\n")[0], 10);
        if (!pid || isNaN(pid)) return resolve(null);
        exec(`ps -p ${pid} -o comm=`, { windowsHide: true }, (e2, out2) => {
          resolve({ pid, name: (out2?.trim() || "unknown") });
        });
      });
    }
  });
}

async function killLeftoverMitm(sudoPassword) {
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill("SIGKILL"); } catch { }
    serverProcess = null;
    serverPid = null;
  }
  try {
    if (fs.existsSync(PID_FILE)) {
      const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
      if (savedPid && isProcessAlive(savedPid)) {
        killProcess(savedPid, true, sudoPassword);
        await new Promise(r => setTimeout(r, 500));
      }
      fs.unlinkSync(PID_FILE);
    }
  } catch { }
  if (!IS_WIN && SERVER_PATH) {
    try {
      const escaped = SERVER_PATH.replace(/'/g, "'\\''");
      if (sudoPassword || isSudoAvailable()) {
        const { execWithPassword } = require("./dns/dnsConfig");
        await execWithPassword(`pkill -SIGKILL -f "${escaped}" 2>/dev/null || true`, sudoPassword || "").catch(() => { });
      } else {
        exec(`pkill -SIGKILL -f "${escaped}" 2>/dev/null || true`, { windowsHide: true }, () => { });
      }
      await new Promise(r => setTimeout(r, 500));
    } catch { }
  }
}

function pollMitmHealth(timeoutMs, port = MITM_PORT) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const req = https.request(
        { hostname: "127.0.0.1", port, path: "/_mitm_health", method: "GET", rejectUnauthorized: false },
        (res) => {
          let body = "";
          res.on("data", (d) => { body += d; });
          res.on("end", () => {
            try {
              const json = JSON.parse(body);
              resolve(json.ok === true ? { ok: true, pid: json.pid || null } : null);
            } catch { resolve(null); }
          });
        }
      );
      req.on("error", () => {
        if (Date.now() < deadline) setTimeout(check, 500);
        else resolve(null);
      });
      req.end();
    };
    check();
  });
}

async function getMitmStatus() {
  let running = serverProcess !== null && !serverProcess.killed;
  let pid = serverPid;

  if (!running) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (savedPid && isProcessAlive(savedPid)) {
          running = true;
          pid = savedPid;
        } else {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch { }
  }

  const dnsStatus = checkAllDNSStatus();
  const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
  const certExists = fs.existsSync(rootCACertPath);
  const { checkCertInstalled } = require("./cert/install");
  const certTrusted = certExists ? await checkCertInstalled(rootCACertPath) : false;

  return { running, pid, certExists, certTrusted, dnsStatus };
}

async function scheduleMitmRestart(apiKey) {
  if (mitmIsRestarting) return;
  mitmIsRestarting = true;

  const aliveMs = Date.now() - mitmLastStartTime;
  if (aliveMs >= MITM_RESTART_RESET_MS) mitmRestartCount = 0;

  if (mitmRestartCount >= MITM_MAX_RESTARTS) {
    err("Max restart attempts reached. Giving up.");
    mitmIsRestarting = false;
    return;
  }

  const attempt = mitmRestartCount;
  const delay = MITM_RESTART_DELAYS_MS[Math.min(attempt, MITM_RESTART_DELAYS_MS.length - 1)];
  mitmRestartCount++;

  log(`Restarting in ${delay / 1000}s... (${mitmRestartCount}/${MITM_MAX_RESTARTS})`);
  await new Promise((r) => setTimeout(r, delay));

  try {
    const settings = _getSettings ? await _getSettings() : null;
    if (settings && !settings.mitmEnabled) {
      log("MITM disabled, skipping restart");
      mitmIsRestarting = false;
      return;
    }
    const password = getCachedPassword() || await loadEncryptedPassword();
    if (!password && !IS_WIN) {
      err("No cached password, cannot auto-restart");
      mitmIsRestarting = false;
      return;
    }
    await startServer(apiKey, password);
    log("🔄 Restarted successfully");
    mitmRestartCount = 0;
    mitmIsRestarting = false;
  } catch (e) {
    err(`Restart attempt ${mitmRestartCount}/${MITM_MAX_RESTARTS} failed: ${e.message}`);
    mitmIsRestarting = false;
    scheduleMitmRestart(apiKey);
  }
}

async function killPort443Owner(owner, sudoPassword) {
  if (!owner || !owner.pid) return;
  if (IS_WIN) {
    try {
      execSync(`powershell -NonInteractive -WindowStyle Hidden -Command "Stop-Process -Id ${owner.pid} -Force -ErrorAction SilentlyContinue"`, { windowsHide: true });
    } catch { }
  } else {
    try {
      const { execWithPassword } = require("./dns/dnsConfig");
      if (sudoPassword || isSudoAvailable()) {
        await execWithPassword(`kill -9 ${owner.pid}`, sudoPassword || "");
      } else {
        execSync(`kill -9 ${owner.pid}`, { windowsHide: true });
      }
    } catch { }
  }
  await new Promise(r => setTimeout(r, 800));
}

async function startServer(apiKey, sudoPassword, forceKillPort443 = false) {
  if (!serverProcess || serverProcess.killed) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (savedPid && isProcessAlive(savedPid)) {
          serverPid = savedPid;
          log(`♻️ Reusing existing process (PID: ${savedPid})`);
          await saveMitmSettings(true, sudoPassword);
          if (sudoPassword) setCachedPassword(sudoPassword);
          return { running: true, pid: savedPid };
        } else {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch { }
  }

  if (serverProcess && !serverProcess.killed) {
    throw new Error("MITM server is already running");
  }

  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
  } catch (e) {
    if (e.code === "EEXIST") {
      let stale = false;
      try {
        const pid = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
        stale = !pid || !isProcessAlive(pid);
      } catch { stale = true; }
      if (!stale) throw new Error("MITM server is already starting (lock contention)");
      try { fs.unlinkSync(LOCK_FILE); } catch { }
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
    } else throw e;
  }

  try {
    await killLeftoverMitm(sudoPassword);

  if (!IS_WIN) {
    const portStatus = await checkPort443Free();
    if (portStatus === "in-use" || portStatus === "no-permission") {
      const owner = await getPort443Owner(sudoPassword);
      if (owner) {
        const shortName = owner.name.includes("/")
          ? owner.name.split("/").filter(Boolean).pop()
          : owner.name;
        if (forceKillPort443) {
          log(`Killing process on port 443 (PID ${owner.pid}, name=${shortName})...`);
          await killPort443Owner(owner, sudoPassword);
        } else {
          const e = new Error(`Port 443 is already in use by "${shortName}" (PID ${owner.pid}).`);
          e.code = "PORT_443_BUSY";
          e.portOwner = { pid: owner.pid, name: shortName };
          throw e;
        }
      }
    }
  }

  const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
  const rootCAKeyPath = path.join(MITM_DIR, "rootCA.key");
  const certExists = fs.existsSync(rootCACertPath) && fs.existsSync(rootCAKeyPath);

  if (!certExists || isCertExpired(rootCACertPath)) {
    if (certExists) {
      log("🔐 Cert expired — uninstalling old cert...");
      const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
      try { await uninstallCert(password, rootCACertPath); } catch { }
    }
    log("🔐 Generating Root CA...");
    await generateCert();
  }

  const { checkCertInstalled } = require("./cert/install");
  const rootCATrusted = await checkCertInstalled(rootCACertPath);
  const linuxNoSystemTrust = !IS_WIN && !IS_MAC && !isSudoAvailable();
  if (!rootCATrusted) {
    log("🔐 Cert: not trusted → installing...");
    const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
    if (linuxNoSystemTrust) {
      log(`🔐 Cert: skipping system trust (no sudo). Install ${rootCACertPath} as a trusted CA on machines that use this proxy.`);
    } else {
      if (!password && isSudoPasswordRequired()) {
        throw new Error("Sudo password required to install Root CA certificate");
      }
      try {
        await installCert(password, rootCACertPath);
        log("🔐 Cert: ✅ trusted");
      } catch (e) {
        throw new Error(`Failed to trust certificate: ${e.message}`);
      }
    }
  } else {
    log("🔐 Cert: already trusted ✅");
  }

  let effectiveServerPath = SERVER_PATH;
  if (!effectiveServerPath || !fs.existsSync(effectiveServerPath)) {
    log(`[MITM] server.js missing at ${effectiveServerPath} → recopying`);
    effectiveServerPath = ensureRuntimeServer(resolveBundledServerPath());
    if (!effectiveServerPath || !fs.existsSync(effectiveServerPath)) {
      throw new Error(`MITM server.js not found at ${effectiveServerPath}. Reinstall dardcor-code.`);
    }
  }
  const mitmRouterBase = await resolveMitmRouterBaseUrl();
  log(`🚀 Starting server... (router: ${mitmRouterBase})`);
  if (IS_WIN) {
    const winOwner = await getPort443Owner(sudoPassword);
    if (winOwner) {
      if (forceKillPort443) {
        log(`Killing process on port 443 (PID ${winOwner.pid}, name=${winOwner.name})...`);
        await killPort443Owner(winOwner, sudoPassword);
      } else {
        const e = new Error(`Port 443 is already in use by "${winOwner.name}" (PID ${winOwner.pid}).`);
        e.code = "PORT_443_BUSY";
        e.portOwner = { pid: winOwner.pid, name: winOwner.name };
        throw e;
      }
    }

    serverProcess = spawn(
      process.execPath,
      [effectiveServerPath],
      {
        detached: false,
        windowsHide: true,
        cwd: os.tmpdir(),
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ROUTER_API_KEY: apiKey,
          NODE_ENV: "production",
          MITM_ROUTER_BASE: mitmRouterBase,
        },
      }
    );

    if (_updateSettings) await _updateSettings({ mitmCertInstalled: true }).catch(() => { });
  } else if (isSudoAvailable()) {
    const inlineCmd = [
      `HOME=${shellQuoteSingle(os.homedir())}`,
      `ROUTER_API_KEY=${shellQuoteSingle(apiKey)}`,
      `MITM_ROUTER_BASE=${shellQuoteSingle(mitmRouterBase)}`,
      "NODE_ENV=production",
      shellQuoteSingle(process.execPath),
      shellQuoteSingle(effectiveServerPath),
    ].join(" ");
    serverProcess = spawn(
      "sudo", ["-S", "-E", "sh", "-c", inlineCmd],
      { detached: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    serverProcess.stdin.write(`${sudoPassword}\n`);
    serverProcess.stdin.end();
  } else {
    serverProcess = spawn(process.execPath, [effectiveServerPath], {
      detached: false,
      windowsHide: true,
      cwd: os.tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ROUTER_API_KEY: apiKey,
        NODE_ENV: "production",
        MITM_ROUTER_BASE: mitmRouterBase,
      },
    });
  }

  if (serverProcess) {
    serverPid = serverProcess.pid;
    fs.writeFileSync(PID_FILE, String(serverPid));
    mitmLastStartTime = Date.now();
  }

  if (IS_MAC) {
    const rootCAPath = path.join(MITM_DIR, "rootCA.crt");
    if (fs.existsSync(rootCAPath)) {
      exec(`launchctl setenv NODE_EXTRA_CA_CERTS "${rootCAPath}"`, { windowsHide: true }, (e) => {
        if (e) log(`[launchctl] Failed to set NODE_EXTRA_CA_CERTS: ${e.message}`);
        else log(`[launchctl] NODE_EXTRA_CA_CERTS set to ${rootCAPath}`);
      });
    }
  } else if (IS_WIN) {
    const rootCAPath = path.join(MITM_DIR, "rootCA.crt");
    if (fs.existsSync(rootCAPath)) {
      exec(`setx NODE_EXTRA_CA_CERTS "${rootCAPath}"`, { windowsHide: true }, (e) => {
        if (e) log(`[setx] Failed to set NODE_EXTRA_CA_CERTS: ${e.message}`);
        else log(`[setx] NODE_EXTRA_CA_CERTS set for current user`);
      });
    }
  }

  let startError = null;
  if (serverProcess) {
    serverProcess.stdout.on("data", (data) => {
      process.stdout.write(data);
    });
    serverProcess.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg && (IS_WIN || (!msg.includes("Password:") && !msg.includes("password for")))) {
        err(msg);
        startError = msg;
      }
      if (!IS_WIN && (msg.includes("incorrect password") || msg.includes("no password was provided"))) {
        setCachedPassword(null);
        clearEncryptedPassword();
        mitmIsRestarting = true;
      }
    });
    serverProcess.on("exit", (code) => {
      log(`Server exited (code: ${code})`);
      serverProcess = null;
      serverPid = null;
      try { fs.unlinkSync(PID_FILE); } catch { }
      try { fs.unlinkSync(LOCK_FILE); } catch { }
      if (code !== 0 && !mitmIsRestarting) scheduleMitmRestart(apiKey);
    });
  }

  const health = await pollMitmHealth(8000, MITM_PORT);
  if (!health) {
    if (serverProcess && !serverProcess.killed) { try { serverProcess.kill(); } catch { } serverProcess = null; }
    const processUsing443 = getProcessUsingPort443();
    const portInfo = processUsing443 ? ` Port 443 already in use by ${processUsing443}.` : "";
    const reason = startError || `Check sudo password or port 443 access.${portInfo}`;
    throw new Error(`MITM server failed to start. ${reason}`);
  }

  if (_updateSettings) await _updateSettings({ mitmCertInstalled: true }).catch(() => { });

  log(`✅ Server healthy (PID: ${serverPid || health.pid})`);

  const dnsStatus = checkAllDNSStatus();
  for (const [tool, active] of Object.entries(dnsStatus)) {
    log(`🌐 DNS ${tool}: ${active ? "✅ active" : "❌ inactive"}`);
  }

  await saveMitmSettings(true, sudoPassword);
  if (sudoPassword) setCachedPassword(sudoPassword);

  try { fs.unlinkSync(LOCK_FILE); } catch { }

  return { running: true, pid: serverPid };
  } catch (e) {
    try { fs.unlinkSync(LOCK_FILE); } catch { }
    throw e;
  }
}

async function stopServer(sudoPassword) {
  mitmIsRestarting = true;
  mitmRestartCount = 0;
  log("⏹ Stopping server...");

  const proc = serverProcess;
  const pidToKill = proc && !proc.killed
    ? proc.pid
    : (() => { try { return parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10); } catch { return null; } })();

  if (pidToKill && isProcessAlive(pidToKill)) {
    log(`Killing server (PID: ${pidToKill})...`);
    killProcess(pidToKill, false, sudoPassword);
    await new Promise(r => setTimeout(r, 1000));
    if (isProcessAlive(pidToKill)) killProcess(pidToKill, true, sudoPassword);
  }
  serverProcess = null;
  serverPid = null;

  if (IS_WIN) {
    const hostsFile = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts");
    const allHosts = Object.values(TOOL_HOSTS).flat();
    try {
      const { isAdmin, runElevatedPowerShell, quotePs } = require("./winElevated.js");
      if (isAdmin()) {
        const content = fs.readFileSync(hostsFile, "utf8");
        const filtered = content.split(/\r?\n/).filter(l => !allHosts.some(h => l.includes(h))).join("\r\n");
        const next = filtered.replace(/[\r\n\s]+$/g, "") + "\r\n";
        if (next !== content) fs.writeFileSync(hostsFile, next, "utf8");
        try { require("child_process").execSync("ipconfig /flushdns", { windowsHide: true, stdio: "ignore" }); } catch { }
        log("🌐 DNS: ✅ all tool hosts removed");
      } else {
        const hostsList = allHosts.map(quotePs).join(",");
        const script = `
          $hosts = @(${hostsList})
          $lines = Get-Content -LiteralPath ${quotePs(hostsFile)}
          $filtered = $lines | Where-Object {
            $line = $_
            -not ($hosts | Where-Object { $line -match [regex]::Escape($_) })
          }
          Set-Content -LiteralPath ${quotePs(hostsFile)} -Value $filtered
          ipconfig /flushdns | Out-Null
        `;
        await runElevatedPowerShell(script);
      }
    } catch (e) { err(`Failed to clean hosts: ${e.message}`); }
  } else {
    await removeAllDNSEntries(sudoPassword);
  }

  if (IS_MAC) {
    exec(`launchctl unsetenv NODE_EXTRA_CA_CERTS`, { windowsHide: true }, (e) => {
      if (e) log(`[launchctl] Failed to unset NODE_EXTRA_CA_CERTS: ${e.message}`);
      else log(`[launchctl] NODE_EXTRA_CA_CERTS unset`);
    });
  } else if (IS_WIN) {
    exec(`reg delete HKCU\\Environment /F /V NODE_EXTRA_CA_CERTS`, { windowsHide: true }, (e) => {
      if (e) log(`[reg] Failed to unset NODE_EXTRA_CA_CERTS: ${e.message}`);
      else log(`[reg] NODE_EXTRA_CA_CERTS unset`);
    });
  }

  try { fs.unlinkSync(PID_FILE); } catch { }
  try { fs.unlinkSync(LOCK_FILE); } catch { }
  await saveMitmSettings(false, null);
  mitmIsRestarting = false;

  return { running: false, pid: null };
}

async function enableToolDNS(tool, sudoPassword) {
  const status = await getMitmStatus();
  if (!status.running) throw new Error("MITM server is not running. Start the server first.");

  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  await addDNSEntry(tool, password);
  await saveDnsToolState(tool, true);
  return { success: true };
}

async function disableToolDNS(tool, sudoPassword) {
  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  await removeDNSEntry(tool, password);
  await saveDnsToolState(tool, false);
  return { success: true };
}

async function trustCert(sudoPassword) {
  const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
  if (!fs.existsSync(rootCACertPath)) throw new Error("Root CA not found. Start server first to generate it.");
  const { installCert } = require("./cert/install");
  if (!IS_WIN && !IS_MAC && !isSudoAvailable()) {
    log(`🔐 Cert: system trust unavailable (no sudo). Use file: ${rootCACertPath}`);
    return;
  }
  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  if (!password && isSudoPasswordRequired()) throw new Error("Sudo password required to trust certificate");
  await installCert(password, rootCACertPath);
  if (password) setCachedPassword(password);
}

const startMitm = startServer;
const stopMitm = stopServer;

module.exports = {
  getMitmStatus,
  startServer,
  stopServer,
  enableToolDNS,
  disableToolDNS,
  trustCert,
  startMitm,
  stopMitm,
  getCachedPassword,
  setCachedPassword,
  loadEncryptedPassword,
  clearEncryptedPassword,
  isSudoPasswordRequired,
  initDbHooks,
  restoreToolDNS,
  hasDnsPrivilege,
  removeAllDNSEntriesSync,
};
