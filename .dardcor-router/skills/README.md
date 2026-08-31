# Dardcor Code — Agent Skills

Drop-in skills for any AI agent (Claude, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use Dardcor Code for you.

> Tip: start with the **dardcor-code** entry skill — it covers setup and links to all capability skills.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | https://raw.githubusercontent.com/dardcor/dardcor-code/refs/heads/master/skills/dardcor-code/SKILL.md |
| Chat / code-gen | https://raw.githubusercontent.com/dardcor/dardcor-code/refs/heads/master/skills/dardcor-code-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/dardcor/dardcor-code/refs/heads/master/skills/dardcor-code-image/SKILL.md |
| Video generation (xAI Grok Imagine) | https://raw.githubusercontent.com/dardcor/dardcor-code/refs/heads/master/skills/dardcor-code-video/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/dardcor/dardcor-code/refs/heads/master/skills/dardcor-code-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/dardcor/dardcor-code/refs/heads/master/skills/dardcor-code-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/dardcor/dardcor-code/refs/heads/master/skills/dardcor-code-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/dardcor/dardcor-code/refs/heads/master/skills/dardcor-code-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/dardcor/dardcor-code/refs/heads/master/skills/dardcor-code-web-fetch/SKILL.md |

## How to use

Paste to your AI (Claude, Cursor, ChatGPT, …):

```
Read this skill and use it: https://raw.githubusercontent.com/dardcor/dardcor-code/refs/heads/master/skills/dardcor-code/SKILL.md
```

Then ask normally — *"generate an image of a cat"*, *"transcribe this URL"*, etc.

## Configure your shell once

```bash
export DARDCORROUTER_URL="http://localhost:20128"   # local default, or your VPS / tunnel URL
export DARDCORROUTER_KEY="sk-..."                   # from Dashboard → Keys (only if requireApiKey=true)
```

Verify: `curl $DARDCORROUTER_URL/api/health` → `{"ok":true}`.

## Links

- Source: https://github.com/dardcor/dardcor-code
- Dashboard: https://dardcor-code.web.id
