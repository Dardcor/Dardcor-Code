ok sekarang tugas baru ini : C:\Users\Dardcor\.dardcor\provider\db\database.json 

bagian ini C:\Users\Dardcor\.dardcor\provider\db\backups pindahkan menjadi : C:\Users\Dardcor\.dardcor\provider\backups

nah saya ingin merapikan penyimpanan data dari Dardcor Router agar setiap provider memiliki folder nya tersendiri di dalam subfolder provider: 

C:\Users\Dardcor\.dardcor\provider\provider\Antigravity\Antigravity.json
C:\Users\Dardcor\.dardcor\provider\provider\Gemini\Gemini.json
C:\Users\Dardcor\.dardcor\provider\provider\OpenAI\OpenAI.json
C:\Users\Dardcor\.dardcor\provider\provider\OpenAI-Codex\OpenAI-Codex.json

---

## 1. Analisis Struktur Penyimpanan Saat Ini (Monolitik)

Seluruh data router saat ini tersimpan dalam satu file JSON tunggal:
- **Lokasi File Utama**: `C:\Users\Dardcor\.dardcor\provider\db\database.json`
- **Lokasi Backups Saat Ini**: `C:\Users\Dardcor\.dardcor\provider\db\backups\` (terselip di dalam folder `db`)

### Masalah pada Struktur Lama:
1. **Penyatuan Akun (Monolithic Connection)**: Semua akun provider (`providerConnections`), baik OAuth maupun API Key (Antigravity, Gemini, OpenAI, Codex, Claude, Grok, dll.) ditumpuk dalam 1 array JSON besar bersama data sistem dan riwayat pemakaian.
2. **Lokasi Backup Tidak Rapi**: Folder `backups/` berada di dalam folder `db/` bersama file aktif `database.json`.
3. **Risiko Integritas**: Jika ada write error saat menyimpan token baru, seluruh database (termasuk setelan router, API keys, dan provider lain) rentan terdampak.
4. **Isolasi Sulit**: Tidak dapat memindahkan, mengisolasi, atau mereset data 1 provider tanpa memengaruhi provider lainnya.

---

## 2. Blueprint Struktur Baru (Target Modular Storage)

Direktori Basis: `C:\Users\Dardcor\.dardcor\provider\`

```text
C:\Users\Dardcor\.dardcor\provider\
│
├── backups\                                <-- [DIPINDAHKAN DARI db/backups]
│   ├── migrate-1-20260908-xxxxxx\          <-- Backup otomatis sebelum migrasi schema
│   │   ├── database.json
│   │   └── ...
│   └── manual-backup-xxxxxx.json           <-- Backup manual download dari UI
│
├── auth\                                   <-- Keamanan & Kredensial Internal Mesin
│   ├── jwt-secret                          <-- Secret signing token session dashboard
│   ├── cli-secret                          <-- Secret otentikasi CLI lokal
│   └── machine-id                          <-- Fingerprint mesin unik
│
├── catalog\                                <-- Model Catalog & Metadata
│   ├── model-catalog.json                  <-- Cache spesifikasi model (context limit, modalitas)
│   └── model-catalog-raw.json              <-- Raw catalog dari upstream models.dev
│
├── logs\                                   <-- Log Aktivitas & Debug
│   ├── provider.log                        <-- Log service utama Dardcor Router
│   └── mitm\                               <-- Dump log request/response MITM
│
├── runtime\                                <-- Binaries & Runtime Tools
│   ├── mitm\                               <-- Sertifikat CA & state MITM
│   ├── pxpipe\                             <-- Binary & state PxPipe
│   ├── tailscale\                          <-- State Tailscale tunnel
│   └── tunnel\                             <-- State Cloudflare tunnel (cloudflared)
│
├── system\                                 <-- KONFIGURASI INTI SISTEM (NON-PROVIDER)
│   ├── db\
│   │   ├── settings.json                   <-- Preferensi router (round-robin, SSO, proxy, auth)
│   │   ├── api-keys.json                   <-- API Key yang dibuat user untuk akses router
│   │   ├── combos.json                     <-- Konfigurasi model combo / fallback routing
│   │   ├── proxy-pools.json                <-- Konfigurasi proxy pool keluar (outbound proxies)
│   │   ├── aliases.json                    <-- Alias model & pemetaan custom models
│   │   └── pricing.json                    <-- Override harga token per model
│   └── usage\
│       ├── history.json                    <-- Riwayat panggilan token (usage history)
│       ├── daily.json                      <-- Agregasi pemakaian harian (usage daily stats)
│       └── request-details.json            <-- Log detail inspeksi request (observability)
│
└── provider\                               <-- PENYIMPANAN MODULAR TIAP PROVIDER (C:\Users\Dardcor\.dardcor\provider\provider\)
    │
    ├── Antigravity\
    │   └── Antigravity.json                <-- Semua akun & data khusus Antigravity
    │
    ├── Gemini\
    │   └── Gemini.json                     <-- Semua akun & API Key Google Gemini
    │
    ├── Gemini-CLI\
    │   └── Gemini-CLI.json                 <-- Akun OAuth Gemini CLI (Google Cloud SDK)
    │
    ├── OpenAI\
    │   └── OpenAI.json                     <-- Akun & API Key OpenAI resmi
    │
    ├── OpenAI-Codex\
    │   └── OpenAI-Codex.json               <-- Akun OAuth ChatGPT Plus/Team/Enterprise
    │
    ├── Claude\
    │   └── Claude.json                     <-- Akun Anthropic Claude (API Key & OAuth)
    │
    ├── DeepSeek\
    │   └── DeepSeek.json                   <-- Akun DeepSeek Platform API
    │
    ├── Grok\
    │   └── Grok.json                       <-- Akun xAI (Grok API resmi)
    │
    ├── Grok-CLI\
    │   └── Grok-CLI.json                   <-- Akun Grok Build / CLI OAuth
    │
    ├── Grok-Web\
    │   └── Grok-Web.json                   <-- Akun Grok Web Cookie session
    │
    ├── Qoder\
    │   └── Qoder.json                      <-- Akun Qoder OAuth
    │
    ├── Groq\
    │   └── Groq.json                       <-- Akun Groq Cloud API
    │
    ├── Mistral\
    │   └── Mistral.json                    <-- Akun Mistral AI API
    │
    ├── OpenRouter\
    │   └── OpenRouter.json                 <-- Akun OpenRouter API Key
    │
    ├── Ollama\
    │   └── Ollama.json                     <-- Konfigurasi Ollama Cloud / Remote
    │
    ├── Ollama-Local\
    │   └── Ollama-Local.json               <-- Konfigurasi Ollama Localhost
    │
    ├── GitHub-Copilot\
    │   └── GitHub-Copilot.json             <-- Akun GitHub Copilot OAuth
    │
    ├── GitLab-Duo\
    │   └── GitLab-Duo.json                 <-- Akun GitLab Duo OAuth
    │
    ├── Kimi\
    │   └── Kimi.json                       <-- Akun Moonshot Kimi AI
    │
    ├── Kiro\
    │   └── Kiro.json                       <-- Akun Kiro AI
    │
    ├── KiloCode\
    │   └── KiloCode.json                   <-- Akun Kilo Code OAuth
    │
    ├── Perplexity\
    │   └── Perplexity.json                 <-- Akun Perplexity API Key
    │
    ├── Perplexity-Web\
    │   └── Perplexity-Web.json             <-- Akun Perplexity Web Cookie
    │
    ├── Minimax\
    │   └── Minimax.json                    <-- Akun Minimax Coding API
    │
    ├── Minimax-CN\
    │   └── Minimax-CN.json                 <-- Akun Minimax China
    │
    ├── GLM\
    │   └── GLM.json                        <-- Akun Zhipu GLM API
    │
    ├── GLM-CN\
    │   └── GLM-CN.json                     <-- Akun Zhipu GLM China
    │
    ├── Together\
    │   └── Together.json                   <-- Akun Together AI
    │
    └── [Provider Lainnya...]\
        └── [ProviderName].json
```

---

## 3. Daftar Lengkap Pemetaan Provider ke Direktori

| No | ID Provider Internal | Nama Folder Provider | File Database Provider | Jenis Provider / Auth |
|---|---|---|---|---|
| 1 | `antigravity` | `Antigravity` | `provider\Antigravity\Antigravity.json` | Google Antigravity (OAuth) |
| 2 | `gemini` | `Gemini` | `provider\Gemini\Gemini.json` | Google Gemini (API Key) |
| 3 | `gemini-cli` | `Gemini-CLI` | `provider\Gemini-CLI\Gemini-CLI.json` | Google Cloud CLI (OAuth) |
| 4 | `openai` | `OpenAI` | `provider\OpenAI\OpenAI.json` | OpenAI (API Key) |
| 5 | `codex` | `OpenAI-Codex` | `provider\OpenAI-Codex\OpenAI-Codex.json` | ChatGPT Codex (OAuth) |
| 6 | `claude` | `Claude` | `provider\Claude\Claude.json` | Anthropic Claude (API Key / OAuth) |
| 7 | `deepseek` | `DeepSeek` | `provider\DeepSeek\DeepSeek.json` | DeepSeek Platform (API Key) |
| 8 | `xai` | `Grok` | `provider\Grok\Grok.json` | xAI Grok (API Key) |
| 9 | `grok-cli` | `Grok-CLI` | `provider\Grok-CLI\Grok-CLI.json` | Grok Build (OAuth) |
| 10 | `grok-web` | `Grok-Web` | `provider\Grok-Web\Grok-Web.json` | Grok Web (Cookie Session) |
| 11 | `qoder` | `Qoder` | `provider\Qoder\Qoder.json` | Qoder (OAuth) |
| 12 | `groq` | `Groq` | `provider\Groq\Groq.json` | Groq Cloud (API Key) |
| 13 | `mistral` | `Mistral` | `provider\Mistral\Mistral.json` | Mistral AI (API Key) |
| 14 | `openrouter` | `OpenRouter` | `provider\OpenRouter\OpenRouter.json` | OpenRouter (API Key) |
| 15 | `ollama` | `Ollama` | `provider\Ollama\Ollama.json` | Ollama Cloud / Remote |
| 16 | `ollama-local` | `Ollama-Local` | `provider\Ollama-Local\Ollama-Local.json` | Ollama Localhost (Auto-detect) |
| 17 | `github` | `GitHub-Copilot` | `provider\GitHub-Copilot\GitHub-Copilot.json` | GitHub Copilot (OAuth) |
| 18 | `gitlab` | `GitLab-Duo` | `provider\GitLab-Duo\GitLab-Duo.json` | GitLab Duo (OAuth) |
| 19 | `kimi` | `Kimi` | `provider\Kimi\Kimi.json` | Moonshot Kimi AI (OAuth) |
| 20 | `kiro` | `Kiro` | `provider\Kiro\Kiro.json` | Kiro AI (Free Provider) |
| 21 | `kilocode` | `KiloCode` | `provider\KiloCode\KiloCode.json` | Kilo Code (OAuth) |
| 22 | `perplexity` | `Perplexity` | `provider\Perplexity\Perplexity.json` | Perplexity (API Key) |
| 23 | `perplexity-web` | `Perplexity-Web` | `provider\Perplexity-Web\Perplexity-Web.json` | Perplexity Web (Cookie Session) |
| 24 | `minimax` | `Minimax` | `provider\Minimax\Minimax.json` | Minimax Coding (API Key) |
| 25 | `minimax-cn` | `Minimax-CN` | `provider\Minimax-CN\Minimax-CN.json` | Minimax China (API Key) |
| 26 | `glm` | `GLM` | `provider\GLM\GLM.json` | Zhipu GLM (API Key) |
| 27 | `glm-cn` | `GLM-CN` | `provider\GLM-CN\GLM-CN.json` | Zhipu GLM China (API Key) |
| 28 | `together` | `Together` | `provider\Together\Together.json` | Together AI (API Key) |
| 29 | `cohere` | `Cohere` | `provider\Cohere\Cohere.json` | Cohere (API Key) |
| 30 | `fireworks` | `Fireworks` | `provider\Fireworks\Fireworks.json` | Fireworks AI (API Key) |
| 31 | `cerebras` | `Cerebras` | `provider\Cerebras\Cerebras.json` | Cerebras AI (API Key) |
| 32 | `chutes` | `Chutes` | `provider\Chutes\Chutes.json` | Chutes AI (API Key) |
| 33 | `nebius` | `Nebius` | `provider\Nebius\Nebius.json` | Nebius AI (API Key) |
| 34 | `nvidia` | `Nvidia` | `provider\Nvidia\Nvidia.json` | NVIDIA NIM (API Key) |
| 35 | `siliconflow` | `SiliconFlow` | `provider\SiliconFlow\SiliconFlow.json` | SiliconFlow (API Key) |
| 36 | `volcengine-ark` | `Volcengine` | `provider\Volcengine\Volcengine.json` | ByteDance Volcengine (API Key) |
| 37 | `alicode` | `AliCode` | `provider\AliCode\AliCode.json` | Alibaba Tongyi Lingma (OAuth) |
| 38 | `alicode-intl` | `AliCode-Intl` | `provider\AliCode-Intl\AliCode-Intl.json` | Alibaba Lingma Intl (OAuth) |
| 39 | `opencode` | `OpenCode` | `provider\OpenCode\OpenCode.json` | OpenCode Free |
| 40 | `opencode-go` | `OpenCode-Go` | `provider\OpenCode-Go\OpenCode-Go.json` | OpenCode Go (API Key) |
| 41 | `custom-*` | `Custom-{ID}` | `provider\Custom-{ID}\Custom-{ID}.json` | Custom OpenAI/Anthropic Compatible |

---

## 4. Struktur Isi File JSON

### A. Format File Provider (`provider\{ProviderName}\{ProviderName}.json`)
File ini murni hanya menampung data provider tersebut:
```json
{
  "providerId": "antigravity",
  "providerName": "Antigravity",
  "updatedAt": "2026-09-08T20:00:00.000Z",
  "connections": [
    {
      "id": "df069255-5990-4a6b-b0f8-98349922c717",
      "provider": "antigravity",
      "authType": "oauth",
      "name": "user@example.com",
      "email": "user@example.com",
      "priority": 1,
      "isActive": true,
      "accessToken": "ya29....",
      "refreshToken": "1//...",
      "expiresAt": 1725800000000,
      "testStatus": "active",
      "lastTested": "2026-09-08T19:00:00.000Z",
      "createdAt": "2026-09-01T10:00:00.000Z",
      "updatedAt": "2026-09-08T19:00:00.000Z"
    }
  ],
  "preferences": {
    "defaultModel": null,
    "thinkingMode": "auto",
    "budgetTokens": 10000
  },
  "cache": {
    "thoughtSignatures": {}
  }
}
```

### B. Format File Sistem (`system\db\settings.json`)
```json
{
  "id": 1,
  "fallbackStrategy": "round-robin",
  "stickyRoundRobinLimit": 3,
  "comboStrategy": "round-robin",
  "comboStickyRoundRobinLimit": 1,
  "requireLogin": false,
  "hasPassword": false,
  "authMode": "password",
  "ssoType": "saml",
  "outboundProxyEnabled": false,
  "outboundProxyUrl": "",
  "outboundNoProxy": "",
  "enableObservability": true
}
```

### C. Format File API Keys Router (`system\db\api-keys.json`)
```json
[
  {
    "id": "ak_1",
    "key": "sk-dardcor-...",
    "name": "Default Key",
    "machineId": "...",
    "isActive": true,
    "createdAt": "2026-08-26T20:00:00.000Z"
  }
]
```

### D. Format File Combos (`system\db\combos.json`)
```json
[
  {
    "id": "combo_1",
    "name": "smart-router",
    "kind": "chat",
    "models": ["claude-3-5-sonnet", "gpt-4o", "gemini-1.5-pro"],
    "createdAt": "2026-09-01T00:00:00.000Z",
    "updatedAt": "2026-09-08T00:00:00.000Z"
  }
]
```

### E. Format File Proxy Pools (`system\db\proxy-pools.json`)
```json
[
  {
    "id": "pp_1",
    "name": "US Residential Pool",
    "proxyUrl": "http://user:pass@proxy.example.com:8080",
    "noProxy": "localhost,127.0.0.1",
    "isActive": true,
    "testStatus": "success",
    "createdAt": "2026-09-01T00:00:00.000Z",
    "updatedAt": "2026-09-08T00:00:00.000Z"
  }
]
```

---

## 5. Rencana Migrasi Otomatis (Zero Data Loss)

1. **Pre-flight Check saat Router Dijalankan**:
   - Sistem memeriksa keberadaan file legacy `C:\Users\Dardcor\.dardcor\provider\db\database.json`.
   - Jika ditemukan dan folder `provider/system/db/` belum ada:
     - **Tahap 1 (Backup Pengaman)**: Buat backup utuh `database.json` ke `C:\Users\Dardcor\.dardcor\provider\backups\pre-modular-migration-[timestamp]\`.
     - **Tahap 2 (Pindahkan Backups Lama)**: Pindahkan isi `provider\db\backups\` ke `provider\backups\`.
     - **Tahap 3 (Pecah Data Provider)**: Pisahkan array `providerConnections` berdasarkan nama provider ke masing-masing file `provider\provider\{ProviderName}\{ProviderName}.json`.
     - **Tahap 4 (Ekstrak Data Sistem)**: Ekstrak tabel `settings`, `apiKeys`, `combos`, `proxyPools`, `kv` ke dalam `provider\system\db\`.
     - **Tahap 5 (Ekstrak Data Usage)**: Ekstrak tabel `usageHistory`, `usageDaily`, `requestDetails` ke dalam `provider\system\usage\`.
     - **Tahap 6 (Arsipkan Legacy)**: Ubah nama `database.json` menjadi `database.json.migrated` (atau simpan sebagai fallback).

2. **Mekanisme Full JSON Runtime (Pure JS In-Memory Store + Modular JSON)**:
   - **Full JSON Engine (Tanpa dbsqlite / SQLite)**:
     - Dardcor Router 100% murni Full JSON tanpa dependensi SQLite apapun (`node:sqlite`, `better-sqlite3`, maupun `sql.js` telah dihapus sepenuhnya).
     - Seluruh query CRUD, filtering, sorting, dan atomic transaction dieksekusi langsung oleh engine in-memory JavaScript (`src/lib/db/jsonEngine.js`), bebas kompilasi native C++ atau runtime WASM.
     - Operasi pembacaan memori berjalan instan (<0.1ms) tanpa disk I/O bottleneck di seluruh sistem operasi (Linux, macOS, Windows).
   - **Modular Atomic Saver**:
     - Saat terjadi penambahan/pembaruan akun (misal OAuth refresh token), adapter hanya menulis ke file `.json` provider yang bersangkutan secara atomik di `provider/provider/{ProviderName}/{ProviderName}.json` (tanpa menyentuh data provider lain).
     - Data sistem disimpan terpisah di `provider/system/db/*.json` dan log penggunaan di `provider/system/usage/*.json`.

---

## 6. File Codebase yang Disesuaikan di `.dardcor-router`

1. **`src/lib/db/jsonEngine.js` [BARU]**:
   - Engine in-memory Full-JSON murni berbasis JavaScript yang mengelola koleksi data, primary key, conflict resolution (`ON CONFLICT DO UPDATE`), evaluasi kondisi `WHERE`, agregasi `COUNT(*)`, `DISTINCT`, dan transaksi rollback ACID tanpa library SQLite luar.

2. **`src/lib/db/driver.js`**:
   - Menghapus ketergantungan `node:sqlite` dan beralih ke `createJsonStoreAdapter()` dari `jsonEngine.js`.
   - Menghubungkan seluruh repositori langsung ke struktur penyimpanan Full JSON.

3. **`src/lib/db/adapters/` [DIHAPUS]**:
   - Seluruh adapter SQLite (`betterSqliteAdapter.js`, `bunSqliteAdapter.js`, `nodeSqliteAdapter.js`, `sqljsAdapter.js`) telah dihapus secara tuntas.
   - Dependensi `sql.js` dihapus dari `package.json`.

4. **`src/lib/db/modularStore.js`**:
   - Menyimpan dan memuat data secara langsung per-provider: `provider/provider/{ProviderName}/{ProviderName}.json` (tanpa subfolder `db`).
   - Menyediakan auto-population untuk 43 provider kanonikal secara langsung di bawah folder `provider/`.
   - Mengelola penyimpanan sistem di `system/db/` dan `system/usage/`.

5. **`src/lib/db/paths.js` & `src/lib/db/backup.js`**:
   - Root backups di `provider/backups/`.
   - Backup berbasis Full JSON dump.


