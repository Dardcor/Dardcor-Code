---
title: "Integracje CLI — skieruj dowolne CLI do kodowania na Dardcor Code"
version: 3.8.40
lastUpdated: 2026-06-28
---

# Integracje CLI

Dardcor Code dostarcza rodzinę poleceń `setup-*`, które konfigurują CLI do
kodowania (Codex, Claude Code, OpenCode, Cline, …) tak, by używało Dardcor Code jako backendu —
narzędzie rozmawia z **jednym** endpointem, a Dardcor Code kieruje ruch do właściwego providera z
auto-fallbackiem. Każde polecenie odczytuje **aktualny** katalog modeli z działającego
Dardcor Code (lokalnego lub zdalnego) i zapisuje plik konfiguracyjny narzędzia na **Twojej**
maszynie. Klucz API jest odwoływany przez zmienną środowiskową wszędzie tam, gdzie narzędzie
to obsługuje. Polecenia zapisujące lokalny plik środowiska narzędzia są opisane poniżej.

Są też dwa launchery — `Dardcor Code launch` (Claude Code) oraz
`Dardcor Code launch-codex` (Codex) — które uruchamiają CLI z wstrzykniętym właściwym env,
bez zapisywania jakiejkolwiek konfiguracji.

Jednorazową, ręczną konfigurację bazową dwóch najbogatszych integracji znajdziesz w
szczegółowych przewodnikach per narzędzie:

- [Konfiguracja Claude Code](./CLAUDE-CODE-CONFIGURATION.md)
- [Konfiguracja Codex CLI](./CODEX-CLI-CONFIGURATION.md)
- [Tryb zdalny](./REMOTE-MODE.md) — steruj zdalnym Dardcor Code (VPS / Tailnet) z laptopa

---

## Tabela główna

Każde polecenie respektuje **aktywny kontekst** (ustawiany przez `Dardcor Code connect`, zob.
[Tryb zdalny](./REMOTE-MODE.md)) albo jawne flagi `--remote <url> --api-key <key>`.
„Lokalnie vs zdalnie” poniżej oznacza: bez flag celuje w `http://localhost:20128`;
z `--remote` (lub aktywnym kontekstem zdalnym) pobiera katalog z tego
serwera i zapisuje konfigurację lokalnie.

| Polecenie                  | Narzędzie                    | Co zapisuje                                                                                                                              | Kluczowe flagi                                                                                    | Lokalnie vs zdalnie |
| -------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------- |
| `Dardcor Code setup-codex`    | OpenAI Codex CLI             | `~/.codex/<name>.config.toml` — jeden profil na kompatybilny model tekstowy (`codex --profile <name>`)                                   | `--remote` `--api-key` `--only` `--dry-run` `--port` `--codex-home`                               | Oba                 |
| `Dardcor Code setup-claude`   | Claude Code                  | `~/.claude/profiles/<name>/settings.json` — jeden profil na dopasowany model (`CLAUDE_CONFIG_DIR`)                                       | `--remote` `--api-key` `--only` `--dry-run` `--port` `--claude-home`                              | Oba                 |
| `Dardcor Code setup-opencode` | OpenCode (openai-compatible) | `~/.config/opencode/opencode.json` — provider `Dardcor Code` z każdym modelem z katalogu (`opencode -m Dardcor Code/<model>`)                  | `--remote` `--api-key` `--only` `--model` `--dry-run` `--port`                                    | Oba                 |
| `Dardcor Code setup-cline`    | Cline                        | `~/.cline/data/{globalState,secrets}.json` (tryb CLI) + wypisuje ustawienia rozszerzenia VS Code                                         | `--remote` `--api-key` `--model` `--yes` `--dry-run` `--port` `--cline-dir`                       | Oba                 |
| `Dardcor Code setup-kilo`     | Kilo Code                    | `~/.local/share/kilo/auth.json` (CLI) + scala `kilocode.*` do VS Code `settings.json`, jeśli istnieje                                    | `--remote` `--api-key` `--model` `--yes` `--dry-run` `--port` `--auth-path` `--vscode-settings`   | Oba                 |
| `Dardcor Code setup-continue` | Continue / `cn` CLI          | `~/.continue/config.yaml` — modele `provider: openai`, klucz przez `${{ secrets.OMNIROUTE_API_KEY }}`                                    | `--remote` `--api-key` `--only` `--dry-run` `--port` `--config-path`                              | Oba                 |
| `Dardcor Code setup-cursor`   | Cursor                       | Nic — wypisuje kroki w aplikacji (konfiguracja Cursor to nieprzezroczysty SQLite)                                                        | `--remote` `--api-key` `--only` `--port`                                                          | Oba                 |
| `Dardcor Code setup-roo`      | Roo Code                     | `~/.Dardcor Code/roo-settings.json` (dokument importu) + ustawia `roo-cline.autoImportSettingsPath`, jeśli istnieje VS Code `settings.json` | `--remote` `--api-key` `--model` `--yes` `--dry-run` `--port` `--import-path` `--vscode-settings` | Oba                 |
| `Dardcor Code setup-crush`    | Crush                        | `~/.config/crush/crush.json` — provider `openai-compat`, klucz przez `$OMNIROUTE_API_KEY`                                                | `--remote` `--api-key` `--only` `--dry-run` `--port` `--config-path`                              | Oba                 |
| `Dardcor Code setup-goose`    | Goose                        | `~/.config/goose/config.yaml` (`GOOSE_PROVIDER`/`OPENAI_HOST`/`GOOSE_MODEL`) + wypisuje przepis env                                      | `--remote` `--api-key` `--model` `--yes` `--dry-run` `--port` `--config-path`                     | Oba                 |
| `Dardcor Code setup-aider`    | Aider                        | `~/.aider.conf.yml` (`openai-api-base` + `model: openai/<id>`) + wypisuje przepis env                                                    | `--remote` `--api-key` `--model` `--yes` `--dry-run` `--port` `--config-path`                     | Oba                 |
| `Dardcor Code setup-qwen`     | Qwen Code                    | `~/.qwen/settings.json` — tablica V4 `modelProviders.openai` + `OMNIROUTE_API_KEY` w `~/.qwen/.env`                                      | `--remote` `--api-key` `--model` `--yes` `--dry-run` `--port` `--config-path` `--env-path`        | Oba                 |
| `Dardcor Code launch`         | Claude Code                  | Nic — uruchamia `claude` z wstrzykniętymi `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`                                                    | `--remote` `--api-key` `--token` `--profile` `--port`                                             | Oba                 |
| `Dardcor Code launch-codex`   | OpenAI Codex CLI             | Nic — uruchamia `codex` z providerem `Dardcor Code` wstrzykniętym przez flagi `-c`                                                          | `--remote` `--api-key` `--profile` (`-p`) `--port`                                                | Oba                 |

Uwagi o flagach (zweryfikowane w źródle poleceń):

- `--remote <url>` — pobierz katalog ze zdalnego Dardcor Code (nadpisuje `--port`
  i aktywny kontekst). `--api-key <key>` podaje poświadczenie dla tego
  serwera (domyślnie zmienna env `OMNIROUTE_API_KEY` albo token aktywnego kontekstu).
- `--only <patterns>` — podłańcuchy rozdzielone przecinkami; zachowaj tylko ID modeli, które pasują
  (np. `--only glm,kimi`). Dostępne w `setup-codex`, `setup-claude`,
  `setup-opencode`, `setup-continue`, `setup-cursor`, `setup-crush`.
- `--dry-run` — wypisz dokładnie to, co zostałoby zapisane, bez ruszania
  systemu plików. Dostępne w każdym poleceniu `setup-*` **oprócz** `setup-cursor`
  (które nigdy nie zapisuje pliku).
- `--model <id>` — wymagane (lub wybierane interaktywnie) dla narzędzi bez
  auto-odkrywania modeli: Cline, Kilo, Roo, Goose, Qwen, Aider. Te narzędzia
  przyjmują też `--yes` do uruchomień nieinteraktywnych (wtedy wymaga `--model`).
  `setup-opencode` przyjmuje `--model`, by ustawić domyślny model najwyższego poziomu.
- `--port <port>` — lokalny port Dardcor Code (domyślnie `20128`, ignorowany gdy ustawione `--remote`).
  Obecne we wszystkich `setup-*` i obu launcherach.
- Oba launchery (`launch`, `launch-codex`) przyjmują `--profile <name>`, by wybrać
  profil zapisany przez `setup-claude` / `setup-codex`, plus argumenty przekazywane do
  leżącego poniżej binarium `claude` / `codex`.

> `setup-opencode` to **lekka, openai-compatible** integracja OpenCode.
> Jest też bogatsza integracja wtyczkowa — `Dardcor Code setup opencode` — która
> instaluje `@Dardcor Code/opencode-plugin`. To różne polecenia; tabela
> powyżej dokumentuje `setup-opencode`.

---

## Użycie lokalne

Przy Dardcor Code działającym na `localhost:20128` wystarczy uruchomić polecenie setup dla swojego
narzędzia. Katalog jest pobierany z lokalnego serwera.

```bash
# Codex: write a profile per matched model into ~/.codex/
Dardcor Code setup-codex
codex --profile glm52            # use a generated profile

# Claude Code: write per-model profiles, then launch one
Dardcor Code setup-claude
Dardcor Code launch --profile glm52

# OpenCode: write the openai-compatible provider with all catalog models
Dardcor Code setup-opencode
export OMNIROUTE_API_KEY=sk-...  # referenced via {env:OMNIROUTE_API_KEY}, never on disk
opencode -m Dardcor Code/glm/glm-5.2 "..."

# Tools without auto-discovery need an explicit model:
Dardcor Code setup-aider --model glm/glm-5.2
Dardcor Code setup-qwen --model qwen/qwen3.8-max-preview

# Preview without writing anything:
Dardcor Code setup-continue --dry-run
```

Uruchomienie bez zapisywania jakiejkolwiek konfiguracji (tylko wstrzykiwanie env):

```bash
Dardcor Code launch                 # Claude Code → local Dardcor Code
Dardcor Code launch-codex           # Codex CLI → local Dardcor Code
Dardcor Code launch-codex --profile glm52
```

---

## Użycie zdalne

Skieruj dowolne polecenie setup na zdalne Dardcor Code przez `--remote` + `--api-key`.
Katalog jest pobierany ze zdalnego serwera; konfiguracja jest zapisywana na Twojej lokalnej maszynie.

```bash
# OpenCode against a remote VPS, keep only glm/kimi models
Dardcor Code setup-opencode --remote http://192.168.0.15:20128 --api-key oma_live_xxx \
  --only glm,kimi
opencode -m Dardcor Code/glm/glm-5.2 "..."   # export OMNIROUTE_API_KEY first

# Codex profiles from a remote catalog
Dardcor Code setup-codex --remote http://192.168.0.15:20128 --api-key oma_live_xxx

# Launch a CLI straight against the remote
Dardcor Code launch       --remote http://192.168.0.15:20128 --api-key oma_live_xxx
Dardcor Code launch-codex --remote http://192.168.0.15:20128 --api-key oma_live_xxx
```

Zamiast podawać `--remote`/`--api-key` za każdym razem, zaloguj się raz i pozwól, by
**aktywny kontekst** dostarczał je automatycznie:

```bash
Dardcor Code connect 192.168.0.15        # mints a scoped token, stores the context
Dardcor Code setup-codex                 # ← now uses the remote catalog
Dardcor Code setup-opencode              # ← same
Dardcor Code launch                      # ← Claude Code against the remote
```

Zobacz [Tryb zdalny](./REMOTE-MODE.md) o kontekstach, zakresach i zarządzaniu tokenami.

---

## Konwencje Base URL (które narzędzia chcą `/v1`)

Dardcor Code udostępnia powierzchnię OpenAI pod `/v1`, powierzchnię Anthropic w root,
oraz natywną powierzchnię Gemini pod `/v1beta`. Każda integracja jest podpięta w formie, jakiej
oczekuje jej narzędzie (zweryfikowane w źródle poleceń):

| Integracja                                                                 | Zapisywany Base URL | `/v1`?                                      |
| -------------------------------------------------------------------------- | ------------------- | ------------------------------------------- |
| `setup-cline` (`openAiBaseUrl`)                                            | root                | Nie — Cline dopina `/v1/chat/completions`   |
| `setup-goose` (`OPENAI_HOST`)                                              | root                | Nie — Goose dopina ścieżkę                  |
| `setup-aider` (`OPENAI_API_BASE`)                                          | root                | Nie — LiteLLM dopina `/v1/chat/completions` |
| `setup-kilo`, `setup-roo`, `setup-continue`, `setup-crush`, `setup-cursor` | z `/v1`             | Tak                                         |
| `setup-claude` (`ANTHROPIC_BASE_URL`), `launch`                            | root                | Nie — Claude Code dopina `/v1/messages`     |
| `setup-codex`, `launch-codex` (`model_providers.Dardcor Code.base_url`)       | z `/v1`             | Tak                                         |
| `setup-qwen` (`modelProviders.openai[].baseUrl`)                           | z `/v1`             | Tak                                         |

---

## Zachowanie natywnych zależności przy aktualizacji: `--include=optional`

Gdy aktualizujesz przez `Dardcor Code update` (po potwierdzeniu albo z `--apply`),
Dardcor Code uruchamia instalację z wbudowanym `--include=optional`:

```bash
npm install -g Dardcor Code@latest --include=optional
```

To **nie** jest flaga, którą przekazujesz do `Dardcor Code update` — updater zawsze ją stosuje.
Gwarantuje, że `optionalDependencies` (`better-sqlite3`, `keytar`,
`tls-client`, stos SLM LLMLingua) przetrwają aktualizację nawet gdy w konfiguracji npm
masz `omit=optional`, co w przeciwnym razie po cichu usunęłoby natywny sterownik SQLite
i powiązanie z keyringiem OS. Podgląd dokładnego polecenia bez zastosowania:

```bash
Dardcor Code update --dry-run
# [DRY RUN] Would run: npm install -g Dardcor Code@latest --include=optional
```

Inne flagi `Dardcor Code update` (zweryfikowane w źródle): `--check` (exit 1, jeśli
nieaktualne), `--apply` (instalacja bez monitu), `--changelog`, `--no-backup`,
`--yes`.

---

## Zobacz też

- [Konfiguracja Claude Code](./CLAUDE-CODE-CONFIGURATION.md) — głębszy przewodnik Claude Code
- [Konfiguracja Codex CLI](./CODEX-CLI-CONFIGURATION.md) — jednorazowa konfiguracja bazowa `[model_providers.Dardcor Code]`
- [Tryb zdalny](./REMOTE-MODE.md) — konteksty, tokeny dostępu ze scope, sterowanie zdalnym serwerem
- [Referencja narzędzi CLI](../reference/CLI-TOOLS.md) — pełny katalog obsługiwanych narzędzi + strony dashboardu
- [Przewodnik instalacji](./SETUP_GUIDE.md) — metody instalacji i onboarding przy pierwszym uruchomieniu
