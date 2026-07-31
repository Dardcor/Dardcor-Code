# Sessions Layer Rules

This document describes the import layering rules for `src/dc/sessions/`, enforced by the `local/code-import-patterns` ESLint rule.

The sessions layer sits above `dc/workbench` in the VS Code source code hierarchy. For the broader VS Code layer rules (base → platform → editor → workbench → sessions), see `.github/instructions/source-code-organization.instructions.md`.

## Layer Hierarchy

```
┌─────────────────────────────────────────────────────┐
│  Entry Points                                       │
│  sessions.common.main.ts / .desktop.main.ts /       │
│  .web.main.ts / .web.main.internal.ts               │
│  (can import everything below)                      │
└──────────────────────┬──────────────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       │               │               │
       ▼               ▼               ▼
┌────────────┐  ┌────────────┐  ┌────────────────┐
│ contrib/*  │  │ contrib/   │  │                │
│ (chat,     │  │ providers/ │  │  services/*    │
│  sessions, │  │ (agentHost,│  │                │
│  changes,  │  │  copilot,  │  │                │
│  ...)      │  │  remote)   │  │                │
└─────┬──────┘  └─────┬──────┘  └───────┬────────┘
      │               │                │
      │               │                │
      ▼               ▼                ▼
┌─────────────────────────────────────────────────────┐
│  sessions/~  (core: browser/, common/, electron-browser/) │
└─────────────────────────────────────────────────────┘
```

## Rules by Target

### `sessions/~` — Sessions Core

**Path:** `src/dc/sessions/{browser,common,electron-browser}/**`

The foundational layer. It may import from the sessions **services** layer, but not from any `contrib/` code above it.

**Can import from:**
- `dc/base/~`, `dc/base/parts/*/~`
- `dc/platform/*/~`
- `dc/editor/~`, `dc/editor/contrib/*/~`
- `dc/workbench/~`, `dc/workbench/browser/**`, `dc/workbench/services/*/~`
- `dc/sessions/~` (self), `dc/sessions/services/*/~`

> **Note:** The desktop bootstrap entry `src/dc/sessions/electron-browser/sessions.ts` has its own, **more restrictive** rule: it may import only `dc/base/~`, `dc/base/parts/*/~`, `dc/platform/*/~`, `dc/sessions/~`, and `dc/sessions/sessions.desktop.main.js`.

**Cannot import from:**
- ❌ `dc/sessions/contrib/*` — no contrib dependencies
- ❌ `dc/sessions/contrib/providers/*` — no provider dependencies

---

### `sessions/services/*/~` — Sessions Services

**Path:** `src/dc/sessions/services/*/{browser,common}/**`

Service layer sits alongside core. Provides shared service interfaces and implementations.

**Can import from:**
- Everything `sessions/~` can import (**except** `dc/workbench/browser/**`, which is not granted to services), plus:
- `dc/sessions/services/*/~` (sibling services)
- `dc/workbench/contrib/*/~`

**Cannot import from:**
- ❌ `dc/sessions/contrib/*` — no contrib dependencies
- ❌ `dc/sessions/contrib/providers/*` — no provider dependencies

---

### `sessions/contrib/*/~` — Contributions (non-provider)

**Path:** `src/dc/sessions/contrib/*/{browser,common}/**` (excluding `contrib/providers/`)

Feature contributions like `chat`, `sessions`, `changes`, `terminal`, etc.

**Can import from:**
- Everything `sessions/services/*/~` can import, plus:
- `dc/sessions/contrib/*/~` (sibling contributions)

**Cannot import from:**
- ❌ `dc/sessions/contrib/providers/*/~` — **providers are isolated from non-provider contribs**

---

### `sessions/contrib/providers/*/~` — Session Providers

**Path:** `src/dc/sessions/contrib/providers/*/{browser,common}/**`

Provider implementations (`agentHost`, `copilotChatSessions`, `remoteAgentHost`). These are the compute backends that register with `ISessionsProvidersService`.

**Can import from:**
- Everything `sessions/contrib/*/~` can import, plus:
- `dc/sessions/contrib/providers/*/~` (sibling providers)

This is the **most permissive** contrib layer — providers can reach into non-provider contribs and sibling providers, but not vice versa.

---

### Entry Points

| File | Layer | Notes |
|------|-------|-------|
| `sessions.common.main.ts` | `browser` | Shared contributions for all platforms |
| `sessions.desktop.main.ts` | `electron-browser` | Desktop-specific, imports `sessions.common.main.js` |
| `sessions.web.main.ts` | `browser` | Web-specific, imports `sessions.common.main.js` |
| `sessions.web.main.internal.ts` | `browser` | Internal web variant, imports `sessions.web.main.js` |

Entry points can import from all sessions layers: `sessions/~`, `services/*/~`, `contrib/*/~`, and `contrib/providers/*/~`.

---

## Key Constraint

```
contrib/*  ──✕──▶  contrib/providers/*
```

Non-provider contributions **must not** import from provider code. If a provider exposes a symbol needed by non-provider code, that symbol should be extracted to a shared location (`dc/sessions/services/`, `dc/sessions/common/`, or a shared contrib module).

Providers **can** import from non-provider contributions and from sibling providers.
