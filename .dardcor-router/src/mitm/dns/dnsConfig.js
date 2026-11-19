const { exec, spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { log, err } = require("../logger");
const { TOOL_HOSTS } = require("../../shared/constants/mitmToolHosts.js");
const { runElevatedPowerShell, isAdmin } = require("../winElevated.js");

function atomicWriteHostsWin(target, originalContent, newContent) {
  const tmpNew = `${target}.dardcor-code.new`;
  const tmpBak = `${target}.dardcor-code.bak`;
  try {
    fs.writeFileSync(tmpNew, newContent, "utf8");
    try { fs.unlinkSync(tmpBak); } catch { }
    fs.renameSync(target, tmpBak);
    try {
      fs.renameSync(tmpNew, target);
    } catch (e) {
      try { fs.renameSync(tmpBak, target); } catch { fs.writeFileSync(target, originalContent, "utf8"); }
      throw e;
    }
    try { fs.unlinkSync(tmpBak); } catch { }
  } finally {
    try { fs.unlinkSync(tmpNew); } catch { }
  }
}

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const HOSTS_FILE = IS_WIN
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts")
  : "/etc/hosts";

function isSudoAvailable() {
  if (IS_WIN) return false;
  try {
    execSync("command -v sudo", { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function canRunSudoWithoutPassword() {
  if (IS_WIN || !isSudoAvailable()) return true;
  try {
    execSync("sudo -n true", { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function isSudoPasswordRequired() {
  return !IS_WIN && isSudoAvailable() && !canRunSudoWithoutPassword();
}

function execWithPassword(command, password) {
  return new Promise((resolve, reject) => {
    const useSudo = isSudoAvailable();
    const child = useSudo
      ? spawn("sudo", ["-S", "sh", "-c", command], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
      : spawn("sh", ["-c", command], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Exit code ${code}`));
    });

    if (useSudo) {
      child.stdin.write(`${password}\n`);
      child.stdin.end();
    }
  });
}

function normalizeHostsContent(content) {
  const eol = IS_WIN ? "\r\n" : "\n";
  return content.replace(/[\r\n\s]+$/g, "") + eol;
}

async function flushDNS(sudoPassword) {
  if (IS_WIN) return;
  if (IS_MAC) {
    await execWithPassword("dscacheutil -flushcache && killall -HUP mDNSResponder", sudoPassword);
  } else {
    await execWithPassword("resolvectl flush-caches 2>/dev/null || true", sudoPassword);
  }
}

function checkDNSEntry(host = null) {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    if (host) return hostsContent.includes(host);
    return TOOL_HOSTS.antigravity.every(h => hostsContent.includes(h));
  } catch {
    return false;
  }
}

function checkAllDNSStatus() {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    const result = {};
    for (const [tool, hosts] of Object.entries(TOOL_HOSTS)) {
      result[tool] = hosts.every(h => hostsContent.includes(h));
    }
    return result;
  } catch {
    return Object.fromEntries(Object.keys(TOOL_HOSTS).map(t => [t, false]));
  }
}

async function addDNSEntry(tool, sudoPassword) {
  const hosts = TOOL_HOSTS[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const entriesToAdd = hosts.filter(h => !checkDNSEntry(h));
  if (entriesToAdd.length === 0) {
    log(`🌐 DNS ${tool}: already active`);
    return;
  }

  try {
    if (IS_WIN) {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const trimmed = current.replace(/[\r\n\s]+$/g, "");
      const toAppend = entriesToAdd.map(h => `127.0.0.1 ${h}`).join("\r\n");
      const next = `${trimmed}\r\n${toAppend}\r\n`;
      atomicWriteHostsWin(HOSTS_FILE, current, next);
      await runElevatedPowerShell("ipconfig /flushdns | Out-Null");
    } else {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const trimmed = current.replace(/[\r\n\s]+$/g, "");
      const toAppend = entriesToAdd.map(h => `127.0.0.1 ${h}`).join("\n");
      const next = `${trimmed}\n${toAppend}\n`;
      const escaped = next.replace(/'/g, "'\\''");
      await execWithPassword(`printf '%s' '${escaped}' | tee ${HOSTS_FILE} > /dev/null`, sudoPassword);
      await flushDNS(sudoPassword);
    }
    log(`🌐 DNS ${tool}: ✅ added ${entriesToAdd.join(", ")}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : `Failed to add DNS entry: ${error.message}`;
    throw new Error(msg);
  }
}

async function removeDNSEntry(tool, sudoPassword) {
  const hosts = TOOL_HOSTS[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const entriesToRemove = hosts.filter(h => checkDNSEntry(h));
  if (entriesToRemove.length === 0) {
    log(`🌐 DNS ${tool}: already inactive`);
    return;
  }

  try {
    if (IS_WIN) {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const filtered = current.split(/\r?\n/).filter(l => !entriesToRemove.some(h => l.includes(h))).join("\r\n");
      const next = filtered.replace(/[\r\n\s]+$/g, "") + "\r\n";
      atomicWriteHostsWin(HOSTS_FILE, current, next);
      await runElevatedPowerShell("ipconfig /flushdns | Out-Null");
    } else {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const filtered = current.split(/\r?\n/).filter(l => !entriesToRemove.some(h => l.includes(h))).join("\n");
      const next = filtered.replace(/[\r\n\s]+$/g, "") + "\n";
      const escaped = next.replace(/'/g, "'\\''");
      await execWithPassword(`printf '%s' '${escaped}' | tee ${HOSTS_FILE} > /dev/null`, sudoPassword);
      await flushDNS(sudoPassword);
    }
    log(`🌐 DNS ${tool}: ✅ removed ${entriesToRemove.join(", ")}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : `Failed to remove DNS entry: ${error.message}`;
    throw new Error(msg);
  }
}

async function removeAllDNSEntries(sudoPassword) {
  for (const tool of Object.keys(TOOL_HOSTS)) {
    try {
      await removeDNSEntry(tool, sudoPassword);
    } catch (e) {
      err(`DNS ${tool}: failed to remove — ${e.message}`);
    }
  }
}

function removeAllDNSEntriesSync() {
  try {
    if (!fs.existsSync(HOSTS_FILE)) return;
    const allHosts = Object.values(TOOL_HOSTS).flat();
    const content = fs.readFileSync(HOSTS_FILE, "utf8");
    const eol = IS_WIN ? "\r\n" : "\n";
    const filtered = content.split(/\r?\n/).filter(l => !allHosts.some(h => l.includes(h))).join(eol);
    const next = filtered.replace(/[\r\n\s]+$/g, "") + eol;
    if (next === content) return;
    fs.writeFileSync(HOSTS_FILE, next, "utf8");
    if (IS_WIN) {
      try { execSync("ipconfig /flushdns", { windowsHide: true, stdio: "ignore" }); } catch { }
    } else if (IS_MAC) {
      try { execSync("dscacheutil -flushcache && killall -HUP mDNSResponder", { stdio: "ignore" }); } catch { }
    } else {
      try { execSync("resolvectl flush-caches 2>/dev/null || true", { stdio: "ignore" }); } catch { }
    }
  } catch { }
}

module.exports = {
  TOOL_HOSTS,
  addDNSEntry,
  removeDNSEntry,
  removeAllDNSEntries,
  removeAllDNSEntriesSync,
  execWithPassword,
  isSudoAvailable,
  canRunSudoWithoutPassword,
  isSudoPasswordRequired,
  checkDNSEntry,
  checkAllDNSStatus,
};

