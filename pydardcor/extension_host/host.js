#!/usr/bin/env node
/**
 * Dardcor Node Extension Host
 * Loads VS Code style JavaScript extensions from VSIX folders.
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const vscodeShim = require("./vscode_shim.js");

const loadedExtensions = new Map();
let workspaceFolders = [];
let extensionRoot = "";

// Patch require('vscode') so real VS Code extensions receive our compatibility API
const originalRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(request) {
  if (request === "vscode") {
    return vscodeShim;
  }
  return originalRequire.apply(this, arguments);
};

function sendNotification(method, params) {
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    method,
    params
  }) + "\n");
}

function sendResult(id, result) {
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id,
    result
  }) + "\n");
}

function sendError(id, code, message) {
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message }
  }) + "\n");
}

function loadExtension(extensionPath) {
  const packagePath = path.join(extensionPath, "package.json");
  if (!fs.existsSync(packagePath)) {
    throw new Error(`package.json not found in ${extensionPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const name = manifest.name || path.basename(extensionPath);
  const mainRel = manifest.main || "./extension.js";
  const mainPath = path.resolve(extensionPath, mainRel);

  if (!fs.existsSync(mainPath)) {
    throw new Error(`Extension main not found: ${mainPath}`);
  }

  const extModule = require(mainPath);
  const subscriptions = [];
  const context = {
    subscriptions,
    extensionPath,
    globalStoragePath: path.join(extensionPath, ".dardcor-global"),
    storagePath: path.join(extensionPath, ".dardcor-storage"),
    asAbsolutePath(relativePath) {
      return path.join(extensionPath, relativePath);
    }
  };

  if (typeof extModule.activate === "function") {
    extModule.activate(context);
  }

  loadedExtensions.set(name, {
    name,
    path: extensionPath,
    manifest,
    module: extModule,
    context
  });

  return { name, displayName: manifest.displayName || name, version: manifest.version || "0.0.0" };
}

function deactivateExtension(name) {
  const ext = loadedExtensions.get(name);
  if (!ext) return false;

  if (ext.module && typeof ext.module.deactivate === "function") {
    ext.module.deactivate();
  }

  for (const sub of ext.context.subscriptions) {
    try {
      if (sub && typeof sub.dispose === "function") sub.dispose();
    } catch (_) {}
  }

  loadedExtensions.delete(name);
  return true;
}

function handleRequest(msg) {
  try {
    switch (msg.method) {
      case "initialize": {
        workspaceFolders = msg.params.workspaceFolders || [];
        global.dardcorWorkspaceFolders = workspaceFolders.map(p => ({ uri: { fsPath: p }, name: path.basename(p) }));
        extensionRoot = msg.params.extensionRoot || "";
        sendResult(msg.id, { ok: true });
        break;
      }
      case "loadExtension": {
        const result = loadExtension(msg.params.extensionPath);
        sendResult(msg.id, result);
        break;
      }
      case "deactivateExtension": {
        const ok = deactivateExtension(msg.params.name);
        sendResult(msg.id, { ok });
        break;
      }
      case "fireEvent": {
        vscodeShim.events.emit(msg.params.event, msg.params.data);
        sendResult(msg.id, { ok: true });
        break;
      }
      case "executeCommand": {
        vscodeShim.commands.executeRegisteredCommand(msg.params.command, msg.params.args || []);
        sendResult(msg.id, { ok: true });
        break;
      }
      case "treeView.getChildren": {
        Promise.resolve(
          vscodeShim.getTreeChildren(msg.params.viewId, msg.params.elementId || null)
        ).then(children => {
          sendResult(msg.id, { children: children || [] });
        }).catch(err => {
          sendError(msg.id, -32000, err.stack || err.message);
        });
        break;
      }
      default:
        sendError(msg.id, -32601, `Unknown method: ${msg.method}`);
    }
  } catch (e) {
    sendError(msg.id, -32000, e.stack || e.message);
  }
}

let buffer = "";
process.stdin.on("data", chunk => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;

    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && msg.method) {
        handleRequest(msg);
      }
    } catch (e) {
      sendNotification("log", { ext: "host", message: `Parse error: ${e.message}` });
    }
  }
});

process.on("uncaughtException", err => {
  sendNotification("log", { ext: "host", message: `Uncaught: ${err.stack || err.message}` });
});

process.on("unhandledRejection", err => {
  sendNotification("log", { ext: "host", message: `Unhandled rejection: ${err.stack || err.message}` });
});

sendNotification("host.ready", { pid: process.pid });
