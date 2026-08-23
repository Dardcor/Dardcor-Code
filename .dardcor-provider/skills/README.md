# MiawRouter — Agent Skills

Drop-in skills for any AI agent (Claude, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use MiawRouter for you.

> Tip: start with the **miawrouter** entry skill — it covers setup and links to all capability skills.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | https://miawrouter.web.id/skills/miawrouter/SKILL.md |
| Chat / code-gen | https://miawrouter.web.id/skills/miawrouter-chat/SKILL.md |
| Image generation | https://miawrouter.web.id/skills/miawrouter-image/SKILL.md |
| Video generation (xAI Grok Imagine) | https://miawrouter.web.id/skills/miawrouter-video/SKILL.md |
| Text-to-speech | https://miawrouter.web.id/skills/miawrouter-tts/SKILL.md |
| Speech-to-text | https://miawrouter.web.id/skills/miawrouter-stt/SKILL.md |
| Embeddings | https://miawrouter.web.id/skills/miawrouter-embeddings/SKILL.md |
| Web search | https://miawrouter.web.id/skills/miawrouter-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://miawrouter.web.id/skills/miawrouter-web-fetch/SKILL.md |

## How to use

Paste to your AI (Claude, Cursor, ChatGPT, …):

```
Read this skill and use it: https://miawrouter.web.id/skills/miawrouter/SKILL.md
```

Then ask normally — *"generate an image of a cat"*, *"transcribe this URL"*, etc.

## Configure your shell once

```bash
export MIAW_URL="http://localhost:21128"   # local default, or your VPS / tunnel URL
export MIAW_KEY="sk-..."                   # from Dashboard → Keys (only if requireApiKey=true)
```

Verify: `curl $MIAW_URL/api/health` → `{"ok":true}`.

## Links

- Source: https://miawrouter.web.id
- Dashboard: https://miawrouter.web.id
