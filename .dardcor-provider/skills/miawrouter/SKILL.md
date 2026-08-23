---
name: miawrouter
description: Entry point for MiawRouter — local/remote AI gateway with OpenAI-compatible REST for chat, image, TTS, embeddings, web search, web fetch. Use when the user mentions MiawRouter, MIAW_URL, or wants AI without writing provider boilerplate. This skill covers setup + indexes capability skills; fetch the relevant capability SKILL.md from the URLs below when needed.
---

# MiawRouter

Local/remote AI gateway exposing OpenAI-compatible REST. One key, many providers, auto-fallback.

## Setup

```bash
export MIAW_URL="http://localhost:21128"      # or VPS / tunnel URL
export MIAW_KEY="sk-..."                      # from Dashboard → Keys (only if requireApiKey=true)
```

All requests: `${MIAW_URL}/v1/...` with header `Authorization: Bearer ${MIAW_KEY}` (omit if auth disabled).

Verify: `curl $MIAW_URL/api/health` → `{"ok":true}`

## Discover models

```bash
curl $MIAW_URL/v1/models                  # chat/LLM (default)
curl $MIAW_URL/v1/models/image            # image-gen
curl $MIAW_URL/v1/models/tts              # text-to-speech
curl $MIAW_URL/v1/models/embedding        # embeddings
curl $MIAW_URL/v1/models/web              # web search + fetch (entries have `kind` field)
curl $MIAW_URL/v1/models/stt              # speech-to-text
curl $MIAW_URL/v1/models/image-to-text    # vision
```

Use `data[].id` as `model` field in requests. Combos appear with `owned_by:"combo"`.

Response shape:
```json
{ "object": "list", "data": [
  { "id": "openai/gpt-5", "object": "model", "owned_by": "openai", "created": 1735000000 },
  { "id": "tavily/search", "object": "model", "kind": "webSearch", "owned_by": "tavily", "created": 1735000000 }
]}
```

## Capability skills

When the user needs a specific capability, fetch that skill's `SKILL.md` from its raw URL:

| Capability | Raw URL |
|---|---|
| Chat / code-gen | https://miawrouter.web.id/skills/miawrouter-chat/SKILL.md |
| Image generation | https://miawrouter.web.id/skills/miawrouter-image/SKILL.md |
| Text-to-speech | https://miawrouter.web.id/skills/miawrouter-tts/SKILL.md |
| Speech-to-text | https://miawrouter.web.id/skills/miawrouter-stt/SKILL.md |
| Embeddings | https://miawrouter.web.id/skills/miawrouter-embeddings/SKILL.md |
| Web search | https://miawrouter.web.id/skills/miawrouter-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://miawrouter.web.id/skills/miawrouter-web-fetch/SKILL.md |

## Errors

- 401 → set/refresh `MIAW_KEY` (Dashboard → Keys)
- 400 `Invalid model format` → check `model` exists in `/v1/models/<kind>`
- 503 `All accounts unavailable` → wait `retry-after` or add another provider account
