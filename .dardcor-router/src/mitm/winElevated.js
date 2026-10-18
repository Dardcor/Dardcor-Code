const { exec, execSync } = require("child_process");

const IS_WIN = process.platform === "win32";

function isAdmin() {
  if (IS_WIN) {
    try {
      execSync("net session >nul 2>&1", { windowsHide: true, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  return typeof process.getuid === "function" && process.getuid() === 0;
}

function quotePs(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runElevatedPowerShell(script) {
  if (!IS_WIN) return Promise.reject(new Error("Windows-only"));

  const encoded = Buffer.from(script, "utf16le").toString("base64");

  if (isAdmin()) {
    return new Promise((resolve, reject) => {
      exec(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
        { windowsHide: true },
        (error, stdout, stderr) => {
          if (error) reject(new Error(stderr || error.message));
          else resolve(stdout);
        }
      );
    });
  }

  const wrapper = `
    $proc = Start-Process powershell -ArgumentList @(
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
      '-WindowStyle','Hidden','-EncodedCommand','${encoded}'
    ) -Verb RunAs -Wait -PassThru -WindowStyle Hidden;
    if ($proc.ExitCode -ne 0) { throw "Elevated command exited with code $($proc.ExitCode)" }
  `;

  return new Promise((resolve, reject) => {
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ${quotePs(wrapper)}`,
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr || error.message;
          if (msg.includes("canceled by the user") || msg.includes("operation was canceled")) {
            reject(new Error("User canceled UAC prompt"));
          } else {
            reject(new Error(msg));
          }
        } else resolve(stdout);
      }
    );
  });
}

module.exports = { isAdmin, runElevatedPowerShell, quotePs };
