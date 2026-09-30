---
name: vscode-dev-workbench
description: Use when the user wants to run the vscode.dev server locally and exercise the VS Code workbench in the integrated browser against the local `microsoft/vscode` sources. Covers starting the dev server, the `vscode-quality=dev` URL, and browser-driven interaction patterns.
---

# Running vscode.dev Against Local VS Code Sources

The `vscode-dev` repo is the `vscode.dev` server. When run locally with `?vscode-quality=dev`, it serves the VS Code web workbench from the **sibling** `microsoft/vscode` checkout. This is the fastest way to validate web-only changes to the workbench without shipping an Insiders build.

## Layout assumption

`vscode-dev` and `vscode` must be sibling folders:

```
<workRoot>/
  vscode/          # microsoft/vscode checkout
  vscode-dev/      # microsoft/vscode-dev checkout
```

If your paths differ, check `server/` in `vscode-dev` for the source root resolution — the `/vscode-sources/*` route maps to `../vscode`.

## Start the dev server

**Critical:** Run `npm run dev` from the **`vscode-dev`** folder, NOT from `vscode`. The `vscode` repo has no `dev` script and will fail with `npm error Missing script: "dev"`. Terminal tools that simplify/strip leading `cd` into separate commands will silently keep the cwd of a previous terminal — always use an absolute `pushd` or verify with `pwd` before `npm run dev`.

```bash
cd /path/to/vscode-dev     # NOT /path/to/vscode
npm run dev                # runs watch + nodemon; serves https://127.0.0.1:3000
```

If you're driving this through an agent/terminal tool, prefer:

```bash
pushd /absolute/path/to/vscode-dev >/dev/null && pwd && npm run dev
```

On first start you may see one crash like `Cannot find module './indexes'` — it's the watcher racing the first build. nodemon restarts automatically once `out/` finishes compiling. The server is ready when `curl -sk -o /dev/null -w "%{http_code}" https://127.0.0.1:3000/` returns `200`.

## URLs

- `https://127.0.0.1:3000/?vscode-quality=dev` — main workbench, local dev sources
- `https://127.0.0.1:3000/?vscode-version=<commit>` — pinned production commit
- Add `&vscode-log=trace` for verbose client logging

## Interacting via the integrated browser

Use `open_browser_page` and the standard browser tools.

### Enter inserts a newline in the chat input

The chat input is a Monaco editor — `page.keyboard.press('Enter')` inserts a newline. To send, click the **Send** button (`a[aria-label^="Send"]`) or use the send keybinding.

### Hard-reloading after a rebuild

The service worker caches client assets aggressively. A plain reload can still serve stale modules:

```js
await page.evaluate(async () => {
  const regs = await navigator.serviceWorker?.getRegistrations() ?? [];
  await Promise.all(regs.map(r => r.unregister()));
  const keys = await caches?.keys() ?? [];
  await Promise.all(keys.map(k => caches.delete(k)));
});
await page.reload({ waitUntil: 'domcontentloaded' });
```

### Simulating mobile (only when explicitly requested)

The integrated browser panel clamps width, so `page.setViewportSize()` and CDP `setDeviceMetricsOverride` narrow the viewport only as far as the panel allows. User-Agent override and touch emulation work fine:

```js
const client = await page.context().newCDPSession(page);
await client.send('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  platform: 'iPhone'
});
await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await client.send('Emulation.setDeviceMetricsOverride', {
  width: 393, height: 852, deviceScaleFactor: 3, mobile: true,
  screenOrientation: { type: 'portraitPrimary', angle: 0 }
});
await page.reload();
```

For a true mobile viewport, drive a standalone Playwright script with `devices['iPhone 14 Pro']` instead of the integrated browser. If a mobile-responsive overlay intercepts pointer events during automation, fall back to `{ force: true }` on `click()`.

## Known-noise console messages (ignore)

- `Canceled: Canceled` at `clipboardService.js` — cancelled permission probes on hover.
- `NotAllowedError: Failed to execute 'write' on 'Clipboard'` — web clipboard requires a user gesture.
- `[WebTunnelAgentHost] Failed to list tunnels` — only fires when not signed in.
- `The web worker extension host is started in a same-origin iframe!` — expected in dev.
- `Unrecognized feature: 'local-network-access'` — dev manifest warning.
- `[LEAKED DISPOSABLE]` stacks — GC-based tracker; only real if reproducible across reloads.

## Troubleshooting

| Symptom                                                   | Cause                                      | Fix                                                        |
| --------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| `Cannot find module './indexes'` on first run             | nodemon started before TS compile finished | Wait; it auto-restarts                                     |
| Workspace picker opens native dialog and hangs automation | `Select Folder…` needs a real file dialog  | Pick a workspace URL scheme instead, or skip in automation |
| Stale UI after editing `vscode/` sources                  | Service worker cache                       | Unregister SWs + clear caches (snippet above)              |
