
import type { CommandMigration } from "./CommandMigration.js";
import type { HookMigration } from "./HookMigration.js";
import type { McpServerMigration } from "./McpServerMigration.js";
import type { PluginsMigration } from "./PluginsMigration.js";
import type { SessionMigration } from "./SessionMigration.js";
import type { SkillMigration } from "./SkillMigration.js";
import type { SubagentMigration } from "./SubagentMigration.js";

export type MigrationDetails = { plugins: Array<PluginsMigration>, skills: Array<SkillMigration>, sessions: Array<SessionMigration>, mcpServers: Array<McpServerMigration>, hooks: Array<HookMigration>, subagents: Array<SubagentMigration>, commands: Array<CommandMigration>, memory?: Array<string>, };
