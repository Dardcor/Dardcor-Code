# Security Policy

## Supported Versions

Dardcor Code is under active development. Security fixes target the latest `main` branch and the latest published package version.

## Reporting a Vulnerability

Please report security issues privately. Do not open a public issue for secrets, account tokens, OAuth bypasses, remote command execution, path traversal, or data-loss bugs.

Send:

- A short description of the issue.
- Steps to reproduce.
- Impact and affected files or features.
- Logs or screenshots with secrets redacted.

## Secret Handling

Dardcor Code must not hardcode real credentials.

Ignored by git:

- `.env`
- `.env.*`
- `secrets.json`
- `*.secrets.json`
- `oauth_tokens.json`
- `*oauth_tokens*.json`
- `/database/`

OAuth tokens are stored in the user data directory, not in tracked source files.

## Local Security Notes

The app includes agent tools that can read files, write files, and run commands. Treat enabled AI providers and model outputs as untrusted until reviewed. Do not run commands suggested by an AI model unless you understand the effect.
