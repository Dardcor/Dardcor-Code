# Security Policy

Dardcor Corporation takes the security of Dardcor Code and the privacy of developer environments seriously. This document outlines our security policies, supported versions, and the procedure for responsibly disclosing vulnerabilities.

---

## Supported Versions

Security patches and updates are actively maintained for the following versions:

| Version | Supported | Status |
|---------|-----------|--------|
| `1.0.x` | Yes | Current Stable Release |
| `< 1.0.0` | No | End of Life |

We strongly recommend always running the latest stable release of Dardcor Code to ensure you have the latest security patches and dependency updates.

---

## Reporting a Vulnerability

If you discover a security vulnerability in Dardcor Code, please report it responsibly so that we can investigate and address it before public disclosure.

### Preferred Channel
Please report vulnerabilities privately via **[GitHub Security Advisories](https://github.com/Dardcor/Dardcor-Code/security/advisories/new)**. This allows us to communicate directly with you in a secure, confidential environment.

### Alternative Channel
If you cannot use GitHub Security Advisories, send an encrypted or direct email to:
- **Email**: `security@dardcor.code`

### What to Include in Your Report
To help us assess and resolve the issue quickly, please provide:
1. **Summary**: A clear description of the vulnerability and its potential impact.
2. **Reproduction Steps**: Step-by-step instructions or a minimal proof of concept (PoC) to reproduce the behavior.
3. **Environment**:
   - Operating system and version (Windows, Linux, macOS).
   - Dardcor Code version and build architecture (e.g., `v1.0.0`, x64 / ARM64).
   - Node.js / Electron runtime version if relevant.
4. **Threat Vector**: Whether the issue requires local access, user interaction (e.g., opening a malicious repository or workspace), or network reachability.

### Response Timelines
- **Initial Acknowledgment**: Within 48 hours of report receipt.
- **Triage & Assessment**: Within 5 business days, confirming whether the report represents a valid security issue.
- **Remediation & Patching**: We prioritize critical vulnerabilities for immediate hotfix releases. We will coordinate public disclosure with you once the patch is published.

---

## Security Architecture & Threat Model

Dardcor Code is engineered with a privacy-first, local-execution architecture:

### 1. Local AI Credential Isolation
- API keys, access tokens, and custom endpoint configurations (e.g., OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Ollama) are stored exclusively on your local storage device under the user configuration directory (`~/.dardcor/provider/`).
- Credentials are never transmitted to Dardcor servers, analytics backends, or third-party telemetric aggregators.
- All outbound AI inference requests are made directly from your machine to your chosen provider or local model runtime.

### 2. Loopback AI Router Isolation
- The internal AI routing daemon (`.dardcor-router`) binds exclusively to the local loopback interface (`127.0.0.1:25128`).
- The router does not bind to `0.0.0.0` or external network adapters, preventing unauthorized machines on the local network or internet from querying the router or reading provider configuration.

### 3. Electron Sandboxing & IPC Hygiene
- The desktop shell enforces `contextIsolation: true` across renderer processes.
- Inter-Process Communication (IPC) messages between the renderer and main process pass through strictly typed and validated channel handlers, preventing untrusted scripts from gaining direct arbitrary Node.js filesystem or process execution privileges.

### 4. Integrated Terminal Security
- The integrated terminal runs with the privileges of the active operating system user.
- Automated AI agent tools that execute terminal commands require user visibility and explicit interaction to prevent unintentional execution of destructive or untrusted shell commands.

### 5. Binary Verification & Checksums
- Official release artifacts (Windows `.exe`/`.msi`, Linux `.deb`/`.rpm`/`.AppImage`, macOS `.dmg`) are distributed with cryptographic SHA-256 hashes published in `updater.json` and in the official GitHub Release notes.
- Verify downloaded packages against published SHA-256 checksums before installation in high-security environments.

---

## Security Best Practices for Users

1. **Workspace Trust**: Avoid opening repositories or workspace folders from untrusted sources without verifying their contents, build scripts, or `.vscode`/`.dardcor` configuration files.
2. **Environment Variables**: Store sensitive production secrets in local `.env` files that are included in `.gitignore`. Dardcor Code does not log or persist environment variable secrets to disk outside of the active process.
3. **Keep Updated**: Use the built-in update notification system or check [Releases](https://github.com/Dardcor/Dardcor-Code/releases) regularly to maintain the latest security fixes.
