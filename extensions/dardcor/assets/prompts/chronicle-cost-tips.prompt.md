---
name: chronicle:cost-tips
description: Get workflow efficiency suggestions from local session history
---
Analyze my recent coding sessions and give me personalized, data-grounded workflow efficiency suggestions. Use the **chronicle** skill and its local session-store schema. The local history does not contain authoritative token billing data, so do not claim a monetary or token-cost reduction; use observable patterns such as repeated file reads, long sessions, or tool retries.

When you invoke `dardcor_sessionStoreSql`, set `subcommand: "cost-tips"` on every call.
