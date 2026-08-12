---
title: "System wtyczek CLI Dardcor Code"
version: 3.8.40
lastUpdated: 2026-06-28
---

# System wtyczek CLI Dardcor Code

Rozszerzaj CLI `Dardcor Code` bez modyfikowania jego rdzenia. Wtyczki stosują konwencję nazewnictwa `Dardcor Code-cmd-*`, podobnie jak `gh extension` lub `kubectl plugin`.

## Szybki start

```bash
# Install a plugin from npm
Dardcor Code plugin install stripe

# Install a local plugin in development
Dardcor Code plugin install ./my-plugin

# List installed plugins
Dardcor Code plugin list

# Scaffold a new plugin
Dardcor Code plugin scaffold myplugin
cd Dardcor Code-cmd-myplugin
Dardcor Code plugin install .
```

## Anatomia wtyczki

Wtyczka to pakiet npm o nazwie `Dardcor Code-cmd-<name>` (lub `@scope/Dardcor Code-cmd-<name>`).

```
Dardcor Code-cmd-myplugin/
├── package.json     # must have "type": "module" and "main": "index.mjs"
├── index.mjs        # exports register(program, ctx) + optional meta
└── README.md
```

### `package.json`

```json
{
  "name": "Dardcor Code-cmd-myplugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.mjs",
  "engines": { "Dardcor Code": ">=4.0.0" },
  "keywords": ["Dardcor Code-plugin", "Dardcor Code-cmd"]
}
```

### `index.mjs`

```js
export const meta = {
  name: "myplugin",
  version: "0.1.0",
  description: "My plugin for Dardcor Code",
  Dardcor CodeApi: ">=4.0.0",
};

export function register(program, ctx) {
  program
    .command("myplugin")
    .description(meta.description)
    .option("-n, --name <name>")
    .action(async (opts, cmd) => {
      const gOpts = cmd.optsWithGlobals();
      const res = await ctx.apiFetch("/api/combos", {
        baseUrl: gOpts.baseUrl,
        apiKey: gOpts.apiKey,
      });
      const data = await res.json();
      ctx.emit(data, gOpts);
    });
}
```

## API kontekstu wtyczki

Obiekt `ctx` przekazywany do `register(program, ctx)`:

| Property                     | Type             | Description                                                 |
| ---------------------------- | ---------------- | ----------------------------------------------------------- |
| `ctx.apiFetch(path, opts)`   | `async function` | Uwierzytelniony fetch do serwera Dardcor Code                  |
| `ctx.emit(data, opts)`       | `function`       | Wyjście w formacie table/json/jsonl/csv wg flagi `--output` |
| `ctx.t(key)`                 | `async function` | Wyszukiwanie tłumaczenia i18n                               |
| `ctx.withSpinner(label, fn)` | `async function` | Opakowuje async fn w spinner ora                            |
| `ctx.baseUrl`                | `string`         | Rozwiązany base URL                                         |
| `ctx.apiKey`                 | `string \| null` | Klucz API, jeśli podany                                     |

## Odkrywanie

Wtyczki są wykrywane z:

1. `~/.Dardcor Code/plugins/<name>/` — instalacje lokalne użytkownika
2. `OMNIROUTE_PLUGIN_PATH` env var — niestandardowy katalog

Błędy ładowania są przechwytywane i wypisywane jako ostrzeżenia — uszkodzona wtyczka nigdy nie zawiesza CLI.

## Bezpieczeństwo

Wtyczki działają z tymi samymi uprawnieniami procesu Node.js co `Dardcor Code`. Instaluj wtyczki wyłącznie ze źródeł, którym ufasz. `Dardcor Code plugin install` wyświetla wyraźne ostrzeżenie i wymaga `--yes` albo interaktywnego potwierdzenia.

## Publikowanie

1. Upewnij się, że `package.json` ma `"keywords": ["Dardcor Code-plugin"]`
2. `npm publish` jak zwykle
3. Użytkownicy odkrywają wtyczki przez `Dardcor Code plugin search <query>` (przeszukuje rejestr npm)

## Przykładowa wtyczka

Zobacz [`examples/Dardcor Code-cmd-hello/`](../../examples/Dardcor Code-cmd-hello/index.mjs) — minimalny działający przykład z `meta` + `register()`.
