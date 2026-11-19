import { CURSOR_CONFIG } from "../constants/oauth.js";


export class CursorService {
  constructor() {
    this.config = CURSOR_CONFIG;
  }

  generateChecksum(machineId) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    let key = 165;
    const encoded = [];

    for (let i = 0; i < timestamp.length; i++) {
      const charCode = timestamp.charCodeAt(i);
      encoded.push(charCode ^ key);
      key = (key + charCode) & 0xff;
    }

    const base64Encoded = Buffer.from(encoded).toString("base64");
    return `${base64Encoded},${machineId}`;
  }

  buildHeaders(accessToken, machineId, ghostMode = false) {
    const checksum = this.generateChecksum(machineId);

    return {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/connect+proto",
      "Connect-Protocol-Version": "1",
      "x-cursor-client-version": this.config.clientVersion,
      "x-cursor-client-type": this.config.clientType,
      "x-cursor-client-os": this.detectOS(),
      "x-cursor-client-arch": this.detectArch(),
      "x-cursor-client-device-type": "desktop",
      "x-cursor-checksum": checksum,
      "x-ghost-mode": ghostMode ? "true" : "false",
    };
  }

  detectOS() {
    if (typeof process !== "undefined") {
      const platform = process.platform;
      if (platform === "win32") return "windows";
      if (platform === "darwin") return "macos";
      return "linux";
    }
    return "linux";
  }

  detectArch() {
    if (typeof process !== "undefined") {
      const arch = process.arch;
      if (arch === "x64") return "x86_64";
      if (arch === "arm64") return "aarch64";
      return arch;
    }
    return "x86_64";
  }

  async validateImportToken(accessToken, machineId) {
    if (!accessToken || typeof accessToken !== "string") {
      throw new Error("Access token is required");
    }

    if (!machineId || typeof machineId !== "string") {
      throw new Error("Machine ID is required");
    }

    if (accessToken.length < 50) {
      throw new Error("Invalid token format. Token appears too short.");
    }

    const uuidRegex = /^[a-f0-9-]{32,}$/i;
    if (!uuidRegex.test(machineId.replace(/-/g, ""))) {
      throw new Error("Invalid machine ID format. Expected UUID format.");
    }


    return {
      accessToken,
      machineId,
      expiresIn: 86400,
      authMethod: "imported",
    };
  }

  extractUserInfo(accessToken) {
    try {
      const parts = accessToken.split(".");
      if (parts.length === 3) {
        let payload = parts[1];
        while (payload.length % 4) {
          payload += "=";
        }
        const decoded = JSON.parse(
          Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
        );
        return {
          email: decoded.email || decoded.sub,
          userId: decoded.sub || decoded.user_id,
        };
      }
    } catch {
    }

    return null;
  }

  getTokenStorageInstructions() {
    return {
      title: "How to get your Cursor token",
      steps: [
        "1. Open Cursor IDE and make sure you're logged in",
        "2. Find the state.vscdb file:",
        `   - Linux: ${this.config.tokenStoragePaths.linux}`,
        `   - macOS: ${this.config.tokenStoragePaths.macos}`,
        `   - Windows: ${this.config.tokenStoragePaths.windows}`,
        "3. Open the database with SQLite browser or CLI:",
        "   sqlite3 state.vscdb \"SELECT value FROM itemTable WHERE key='cursorAuth/accessToken'\"",
        "4. Also get the machine ID:",
        "   sqlite3 state.vscdb \"SELECT value FROM itemTable WHERE key='storage.serviceMachineId'\"",
        "5. Paste both values in the form below",
      ],
      alternativeMethod: [
        "Or use this one-liner to get both values:",
        "sqlite3 state.vscdb \"SELECT key, value FROM itemTable WHERE key IN ('cursorAuth/accessToken', 'storage.serviceMachineId')\"",
      ],
    };
  }
}
