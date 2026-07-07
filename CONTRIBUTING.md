# Contributing to Dardcor Code

Thanks for helping improve Dardcor Code.

## Development Setup

```bash
git clone https://github.com/Dardcor/Dardcor-Code.git
cd Dardcor-Code
python -m venv .venv
.venv\Scripts\activate
pip install -e .
```

Run the app:

```bash
dardcor
```

Run tests:

```bash
python -m unittest discover tests
```

## Guidelines

- Keep changes small and focused.
- Prefer Python standard library and existing project helpers before adding dependencies.
- Do not commit real API keys, OAuth tokens, `.env` files, generated caches, or local user data.
- Keep UI text in English unless the surrounding UI already uses another language.
- Add or update tests for non-trivial behavior changes.
- Preserve existing README artwork, badges, and screenshots unless the change is explicitly about branding.

## Pull Requests

Before opening a PR:

```bash
python -m unittest discover tests
python -m py_compile dardcor_agent/models/subscription_oauth.py
```

Include a short summary, test notes, and screenshots for visible UI changes.

