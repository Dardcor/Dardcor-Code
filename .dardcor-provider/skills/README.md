# Dardcor Code — Agent Skills

Drop-in skills for any AI agent (Claude, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use Dardcor Code for you.

> Tip: start with the **dardcor-code** entry skill — it covers setup and links to all capability skills.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | https://dardcor-code.web.id/skills/dardcor-code/SKILL.md |
| Chat / code-gen | https://dardcor-code.web.id/skills/dardcor-code-chat/SKILL.md |
| Image generation | https://dardcor-code.web.id/skills/dardcor-code-image/SKILL.md |
| Video generation (xAI Grok Imagine) | https://dardcor-code.web.id/skills/dardcor-code-video/SKILL.md |
| Text-to-speech | https://dardcor-code.web.id/skills/dardcor-code-tts/SKILL.md |
| Speech-to-text | https://dardcor-code.web.id/skills/dardcor-code-stt/SKILL.md |
| Embeddings | https://dardcor-code.web.id/skills/dardcor-code-embeddings/SKILL.md |
| Web search | https://dardcor-code.web.id/skills/dardcor-code-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://dardcor-code.web.id/skills/dardcor-code-web-fetch/SKILL.md |

## How to use

Paste to your AI (Claude, Cursor, ChatGPT, …):

```
Read this skill and use it: https://dardcor-code.web.id/skills/dardcor-code/SKILL.md
```

Then ask normally — *"generate an image of a cat"*, *"transcribe this URL"*, etc.

## Configure your shell once

```bash
export DARDCOR_URL="http://localhost:21128"   # local default, or your VPS / tunnel URL
export DARDCOR_KEY="sk-..."                   # from Dashboard → Keys (only if requireApiKey=true)
```

Verify: `curl $DARDCOR_URL/api/health` → `{"ok":true}`.

## Links

- Source: https://dardcor-code.web.id
- Dashboard: https://dardcor-code.web.id
