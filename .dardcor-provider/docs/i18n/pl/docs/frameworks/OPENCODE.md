---
title: "Integracja z OpenCode"
version: 3.8.40
lastUpdated: 2027-07-27
---

# Integracja z OpenCode

> **Status:** Ogólnie dostępne.
> **Odbiorcy:** Operatorzy podłączający OpenCode do wdrożenia Dardcor Code.
> **Źródło prawdy (schemat konfiguracji):** `src/shared/services/opencodeConfig.ts`
> **Źródło prawdy (pakiet npm):** `@Dardcor Code/opencode-provider/` (publikowalny workspace)

[OpenCode](https://opencode.ai) to agentowy klient AI CLI/desktop. Czyta katalog providerów z `~/.config/opencode/opencode.json` (lub `opencode.jsonc`) i stosuje schemat z `https://opencode.ai/config.json`. Dardcor Code udostępnia się OpenCode jako jeden z tych providerów — każde żądanie przechodzi przez standardową, zgodną z OpenAI powierzchnię `/v1` Dardcor Code, więc OpenCode automatycznie korzysta z routingu Auto-Combo, circuit breakerów, polityk kluczy, observability itd.

Są **dwie obsługiwane ścieżki integracji**. Wybierz jedną — generują tę samą konfigurację.

---

## Ścieżka 1 — generator CLI (bez instalacji npm)

Zalecana dla użytkowników końcowych. Dostarczana z Dardcor Code. Zapisuje `opencode.json` w miejscu.

```bash
# After installing Dardcor Code (npm i -g @Dardcor Code/cli or local clone)
Dardcor Code config opencode \
  --base-url http://localhost:20128 \
  --api-key "$OMNIROUTE_API_KEY"
```

W tle CLI wywołuje `mergeOpenCodeConfigText()` (`src/shared/services/opencodeConfig.ts:104`), więc istniejący `opencode.json` zachowuje pozostałych providerów i komentarze. Wpis Dardcor Code jest dodawany/zastępowany atomowo.

Wynikowy plik (domyślny katalog modeli):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "Dardcor Code": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Dardcor Code",
      "options": {
        "baseURL": "http://localhost:20128/v1",
        "apiKey": "<your-key>",
      },
      "models": {
        "claude-opus-4-5-thinking": { "name": "claude-opus-4-5-thinking" },
        "claude-sonnet-4-5-thinking": { "name": "claude-sonnet-4-5-thinking" },
        "gemini-3.1-pro-high": { "name": "gemini-3.1-pro-high" },
        "gemini-3-flash": { "name": "gemini-3-flash" },
      },
    },
  },
}
```

---

## Ścieżka 2 — pakiet npm `@Dardcor Code/opencode-provider`

Zalecana, gdy skryptujesz konfigurację z Node/TS (pipeline'y CI, monoreposy, własne flow instalatora).

```bash
npm install --save-dev @Dardcor Code/opencode-provider
```

```ts
import { writeFileSync } from "node:fs";
import { buildDardcor CodeOpenCodeConfig } from "@Dardcor Code/opencode-provider";

const config = buildDardcor CodeOpenCodeConfig({
  baseURL: "http://localhost:20128",
  apiKey: process.env.OMNIROUTE_API_KEY ?? "sk_Dardcor Code",
  // Optional: override the model catalog exposed to OpenCode
  models: ["auto", "claude-opus-4-7", "gpt-5.5"],
  modelLabels: { auto: "Auto-Combo" },
});

writeFileSync("opencode.json", JSON.stringify(config, null, 2));
```

Aby nieniszcząco scalić z istniejącym plikiem, odtwórz `mergeOpenCodeConfigText()` z `opencodeConfig.ts` albo wywołaj generator CLI.

Pełne API znajdziesz w [README pakietu](../../@Dardcor Code/opencode-provider/README.md).

---

## Co runtime robi w praktyce

Obie ścieżki produkują to samo `provider.Dardcor Code.npm: "@ai-sdk/openai-compatible"`. W runtime OpenCode ładuje `@ai-sdk/openai-compatible` (już jest zależnością przechodnią OpenCode) i konfiguruje go przez `baseURL` + `apiKey`. Dalej:

```
OpenCode UI/agent
   → @ai-sdk/openai-compatible
      → HTTP POST {baseURL}/chat/completions          (Dardcor Code OpenAI surface)
         → Dardcor Code /v1/chat/completions handler     (open-sse/handlers/chatCore.ts)
            → combo routing / Auto-Combo / executor
               → upstream provider
```

Wtyczka nigdy nie dotyka HTTP. Emisuje wyłącznie konfigurację.

---

## Domyślny katalog modeli

```ts
export const OMNIROUTE_DEFAULT_OPENCODE_MODELS = [
  "claude-opus-4-5-thinking",
  "claude-sonnet-4-5-thinking",
  "gemini-3.1-pro-high",
  "gemini-3-flash",
] as const;
```

Możesz nadpisać przez `models: [...]`. Zalecane dodatki:

- `"auto"` — udostępnia router zero-config [Auto-Combo](../routing/AUTO-COMBO.md) Dardcor Code. Pozwala OpenCode wybrać „najlepszy dostępny model” bez hardkodowania katalogu.
- `"<combo-name>"` — dowolne combo zdefiniowane w dashboardzie; Dardcor Code rozwiązuje je przejrzyście.

---

## Normalizacja URL

Helper akceptuje obie formy i emituje dokładnie jedno `/v1`:

| Wejście                        | Wyjście (`options.baseURL`) |
| ------------------------------ | --------------------------- |
| `http://localhost:20128`       | `http://localhost:20128/v1` |
| `http://localhost:20128/`      | `http://localhost:20128/v1` |
| `http://localhost:20128/v1`    | `http://localhost:20128/v1` |
| `http://localhost:20128/v1///` | `http://localhost:20128/v1` |

Ta deduplikacja to **najczęstsza przyczyna awarii** w starszych konfiguracjach. Jeśli masz `opencode.json` sprzed v3.8.0 wskazujący na `/v1/v1/...`, uruchom generator ponownie albo wywołaj `createDardcor CodeProvider` jeszcze raz.

---

## Tryby uwierzytelniania

| Ustawienie Dardcor Code                         | Zalecana wartość `apiKey`                                  |
| -------------------------------------------- | ---------------------------------------------------------- |
| `REQUIRE_API_KEY=false` (domyślnie lokalnie) | `sk_Dardcor Code` (dosłowny placeholder)                      |
| `REQUIRE_API_KEY=true`                       | Prawdziwy klucz API per użytkownik z Dashboard → API Keys. |

Dla klientów w stylu Anthropic, które wysyłają `x-api-key` + `anthropic-version`, `extractApiKey` Dardcor Code honoruje też klucz z `x-api-key`. OpenCode używa powierzchni OpenAI, więc zawsze wyśle `Authorization: Bearer ${apiKey}` — specjalny przypadek Anthropic tu nie obowiązuje.

---

## Rozwiązywanie problemów

| Objaw                                                | Przyczyna                                                                 | Naprawa                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `404` na każdym żądaniu z URL zawierającym `/v1/v1/` | Przestarzała konfiguracja z wtyczki pre-v3.8, która podwajała `/v1`.      | Wygeneruj ponownie przez Ścieżkę 1 lub 2.                                                              |
| `401 Invalid API key`                                | Dardcor Code ma `REQUIRE_API_KEY=true`, a klucz jest nieznany.               | Utwórz klucz w dashboardzie albo ustaw `REQUIRE_API_KEY=false` (tylko lokalnie) i użyj `sk_Dardcor Code`. |
| Pusta lista modeli w UI OpenCode                     | Wszystkie 4 domyślne modele są ukryte w widoczności providerów Dardcor Code. | Przekaż `models: ["auto", ...]`, aby udostępnić włączone modele.                                       |
| OpenCode 500 z `cannot read property 'models'`       | Starszy OpenCode (< 0.1.x) nie akceptował inline `models`.                | Zaktualizuj OpenCode do wersji zgodnej ze schematem v1 (`opencode.ai/config.json`).                    |

---

## Zobacz też

- [API reference](../reference/API_REFERENCE.md) — pełna powierzchnia REST Dardcor Code
- [Auto-Combo](../routing/AUTO-COMBO.md) — co oznacza `model: "auto"`
- [`@Dardcor Code/opencode-provider` README](../../@Dardcor Code/opencode-provider/README.md)
- Źródło: `src/shared/services/opencodeConfig.ts`, `src/lib/cli-helper/config-generator/opencode.ts`, `@Dardcor Code/opencode-provider/src/index.ts`
