---
name: chronicle:search
description: Search recent chat sessions by keyword, file path, or PR/issue ref
---
Search my local coding-session history for the query I provide — a keyword, file path, or PR/issue/commit ref — and list matching sessions. Use the **chronicle** skill for the `dardcor_sessionStoreSql` tool, local SQLite schema, and search workflow. The `sessions` table primary key is `id`; conversation content lives in `turns`. Use the FTS5 `search_index` table for body text and select its `session_id` directly — never join `search_index.rowid` to `turns.rowid`.

When you invoke `dardcor_sessionStoreSql`, set `subcommand: "search"` on every call.
