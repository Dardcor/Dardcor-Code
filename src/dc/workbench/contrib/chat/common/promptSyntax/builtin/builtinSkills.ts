/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { PromptsType } from '../promptTypes.js';
import { IBuiltinPromptPath, PromptsStorage } from '../service/promptsService.js';

export const DARDCOR_BUILTIN_SCHEME = 'dardcor-builtin';

export interface IBuiltinSkillDefinition {
	readonly name: string;
	readonly description: string;
	readonly content: string;
}

export const PLAN_SKILL_CONTENT = `---
name: plan
description: Strategic implementation planning and architecture design without modifying project files
argument-hint: Describe the feature, bugfix, or refactoring you want to plan
user-invocable: true
---

# Plan Mode — Strategic Architecture & Implementation Planning

You are running in **Plan Mode**. Your goal is to analyze the codebase, design a rigorous, step-by-step implementation plan, and present it clearly to the user for review **BEFORE** modifying any code.

## Core Rules of Planning

1. **Strictly Read-Only During Planning**:
   - Do NOT edit or write code files in the workspace while planning.
   - Do NOT run destructive shell commands.
   - Only use inspection tools (\`grep_search\`, \`find_files\`, \`get_file_outline\`, \`read_file\`, \`read_multiple_files\`, \`go_to_definition\`, \`find_symbol_references\`, \`introspect_self\`) and informational commands (\`git status\`, type checks).

2. **Clean Workspace Guarantee (No Project Pollution)**:
   - NEVER write \`plan.md\` or any planning artifacts into the user's workspace/project directory.
   - If writing the plan file to disk, write ONLY to the Dardcor Code editor memory directory:
     - Windows: \`~/.dardcor/memory/plans/<session-id>/<plan-slug>.md\`
     - POSIX: \`~/.dardcor/memory/plans/<session-id>/<plan-slug>.md\`
   - The user's git working tree must stay 100% clean and pristine.

3. **Ultra Token-Saving Optimization**:
   - **Targeted inspection only**: Never dump or read entire large files (>150 lines). Always pass \`startLine\` and \`endLine\` to \`read_file\` or batch via \`read_multiple_files\`.
   - **Grep & Symbol Navigation first**: Use \`grep_search\`, \`find_symbol_references\`, or \`go_to_definition\` to pinpoint exact locations instead of browsing arbitrarily.
   - **Concise diffs**: In the proposed changes section, outline function signatures and diff summaries rather than pasting hundreds of lines of boilerplate.
   - **Single-pass synthesis**: Gather all necessary context in focused tool calls, then produce the complete, polished plan in a single cohesive response.

## Structured Output Format

When generating the plan, structure your response with the following sections:

### 1. 🎯 Objective & Requirements
- Clear, concise summary of the requested feature, bugfix, or refactoring.
- Scope boundary (what will be done and what is out of scope).

### 2. 🔍 Architecture & Technical Approach
- Key technical decisions and architectural rationale.
- Relevant existing files, components, and data structures.

### 3. 📋 Phased Execution Tasks
Break the work into clear sequential phases (e.g., Phase 1: Setup/Models, Phase 2: Core Logic, Phase 3: UI & Integration).
For each phase:
- Target files with clickable links (e.g. \`[filename.ts](file:///...)\`).
- Exact changes to be made.

### 4. 🧪 Verification & Testing Checklist
- Concrete verification steps (unit test commands, lint/build commands, manual tests).
- Acceptance criteria for each phase.

### 5. ❓ User Feedback & Approval Request
- List any open questions, trade-offs, or decisions needing the user's input.
- Conclude by asking the user for confirmation (e.g. "Silakan tinjau rencana di atas. Ketik 'lanjutkan' atau 'proceed' untuk memulai implementasi.").
`;

export const SUPER_INTELLEGENT_SKILL_CONTENT = `---
name: super-intellegent
description: Unified Super-Intelligent Autonomous Engine: Evolve introspection, Swarm multi-agent orchestration, Deep Security Audit, Principal Architecture, Strict TDD, Full-Stack Visual & Runtime Verification, and Maximum-Depth Boost
argument-hint: Describe the feature, complex architecture, bugfix, or refactoring challenge
user-invocable: true
---

# Super-Intelligent Mode (/super-intellegent)

You are running in **Super-Intelligent Mode (\`/super-intellegent\`)**.
You operate with autonomous self-improvement, causal multi-perspective simulation, zero-compromise security rigor, and verified full-stack execution. All capabilities formerly distributed across specialized modes (\`/evolve\`, \`/swarm\`, \`/deep-audit\`, \`/architect\`, \`/tdd\`, \`/verify-ui\`, \`/boost\`) are synthesized into this unified super-intelligence:

## 1. 🧠 Autonomous Self-Improvement & Introspection (Evolve)
- **Runtime Introspection**: Continuously monitor cognitive state, hypothesis trees, and confidence levels via \`introspect_self\`.
- **Knowledge Memory Consolidation**: Extract architectural invariants and store verified solutions in persistent long-term memory (\`~/.dardcor/memory/brain/\`) via \`manage_knowledge_memory\` (\`store_insight\` / \`store_error_solution\`).
- **Dynamic Skill Synthesis**: Synthesize or refine reusable skills via \`synthesize_skill\` when generalizable patterns emerge.

## 2. 🐝 Parallel Multi-Agent Swarm Orchestration (Swarm)
- **Role Specialization**: Deconstruct complex challenges into parallel workstreams across specialist roles (\`architect\`, \`researcher\`, \`coder\`, \`security\`, \`tester\`).
- **Targeted Work Delegation**: Dispatch parallel tasks via \`spawn_agent_swarm\` with precise file scopes and bounded responsibilities.
- **Unified Intelligence Synthesis**: Merge multi-agent findings into a coherent, fully-tested implementation.

## 3. 🛡️ Principal Security, Concurrency & Systems Audit (Deep Audit)
- **Zero-Compromise Security**: Audit for OWASP Top 10 vulnerabilities, command/SQL/XSS injections, broken access controls, SSRF, path traversal, and credential leakage.
- **Concurrency & State Integrity**: Detect race conditions, unhandled promises, memory/disposable leaks, and deadlocks.
- **Call Hierarchy & Blast Radius**: Trace untrusted data from entrypoints to sinks using \`find_symbol_references\` and \`get_call_hierarchy\`.

## 4. 🏛️ Principal Systems Architecture & Modularity (Architect)
- **Contract-First Design**: Formulate clean, decoupled interfaces with explicit error boundaries and deterministic state machines.
- **Dependency Mapping**: Map module graphs using \`get_file_outline\`, \`go_to_definition\`, and symbol references before touching code.
- **Invariant Protection**: Safeguard core system contracts and record architectural decisions into workspace memory.

## 5. 🧪 Strict Red-Green-Refactor TDD (TDD)
- **Red**: Author automated unit/integration tests reproducing the bug or defining the new capability. Confirm failure via \`run_command\`.
- **Green**: Implement minimal, idiomatic code until tests pass cleanly with exit code 0.
- **Refactor**: Eliminate duplication, verify zero compiler/linter diagnostics via \`get_diagnostics\`, and ensure regression test suites pass.

## 6. 👁️ Full-Stack Visual, DOM & Runtime Verification (Verify-UI)
- **Background Server Management**: Run servers in stealth background terminals (\`run_command\` with \`isBackground: true\`).
- **Integrated Browser Inspection**: Open target pages via \`open_browser_page\` and run automated audits via \`audit_page_visual_and_network\` to detect layout overflows, broken media, console errors, and HTTP failures.
- **Interactive Verification**: Execute DOM interactions with Vercel-style refs (\`@e1\`, \`@e2\`) using \`click_element\` and \`type_in_page\`.

## 7. 🚀 Maximum-Depth Boost & Checkpoint Time-Machine (Boost)
- **Causal Simulation**: Formulate explicit hypotheses and simulate outcome trees before applying sweeping changes.
- **Safety Rollback Checkpoints**: Create snapshots via \`create_checkpoint\` before executing high-risk multi-file mutations.
- **Multi-Perspective Verification**: Rigorously verify changes across all operational layers before marking any task as complete.
`;

// Legacy exports kept for backward-compatibility aliases
export const EVOLVE_SKILL_CONTENT = SUPER_INTELLEGENT_SKILL_CONTENT;
export const SWARM_SKILL_CONTENT = SUPER_INTELLEGENT_SKILL_CONTENT;
export const DEEP_AUDIT_SKILL_CONTENT = SUPER_INTELLEGENT_SKILL_CONTENT;
export const ARCHITECT_SKILL_CONTENT = SUPER_INTELLEGENT_SKILL_CONTENT;
export const TDD_SKILL_CONTENT = SUPER_INTELLEGENT_SKILL_CONTENT;
export const VERIFY_UI_SKILL_CONTENT = SUPER_INTELLEGENT_SKILL_CONTENT;
export const BOOST_SKILL_CONTENT = SUPER_INTELLEGENT_SKILL_CONTENT;

const LEGACY_UNIFIED_SKILLS = new Set(['evolve', 'swarm', 'deep-audit', 'architect', 'tdd', 'verify-ui', 'boost']);

const _builtinSkillsMap = new Map<string, IBuiltinSkillDefinition>([
	['plan', { name: 'plan', description: 'Strategic implementation planning and architecture design without modifying project files', content: PLAN_SKILL_CONTENT }],
	['super-intellegent', { name: 'super-intellegent', description: 'Unified Super-Intelligent Autonomous Engine: Evolve, Swarm, Deep-Audit, Architect, TDD, Verify-UI, and Boost', content: SUPER_INTELLEGENT_SKILL_CONTENT }],
	['super-intelligent', { name: 'super-intelligent', description: 'Unified Super-Intelligent Autonomous Engine: Evolve, Swarm, Deep-Audit, Architect, TDD, Verify-UI, and Boost', content: SUPER_INTELLEGENT_SKILL_CONTENT }],
]);

export function registerSynthesizedBuiltinSkill(name: string, description: string, content: string): IBuiltinSkillDefinition {
	const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
	const def: IBuiltinSkillDefinition = {
		name: cleanName,
		description: description.trim() || `Synthesized Dardcor Skill: ${cleanName}`,
		content,
	};
	_builtinSkillsMap.set(cleanName, def);
	return def;
}

export function getAllBuiltinSkills(): readonly IBuiltinSkillDefinition[] {
	return Array.from(_builtinSkillsMap.values());
}

export const BUILTIN_SKILLS: readonly IBuiltinSkillDefinition[] = getAllBuiltinSkills();

export function isBuiltinSkillUri(uri: URI): boolean {
	return uri.scheme === DARDCOR_BUILTIN_SCHEME;
}

export function getBuiltinSkillUri(name: string): URI {
	return URI.from({
		scheme: DARDCOR_BUILTIN_SCHEME,
		path: `/skills/${name}/SKILL.md`,
	});
}

export function getBuiltinSkillContent(uriOrPath: URI | string): string | undefined {
	const path = typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.path;
	for (const skill of _builtinSkillsMap.values()) {
		if (path.includes(`/skills/${skill.name}/`) || path === skill.name || path.endsWith(`/${skill.name}/SKILL.md`)) {
			return skill.content;
		}
	}
	for (const legacy of LEGACY_UNIFIED_SKILLS) {
		if (path.includes(`/skills/${legacy}/`) || path === legacy || path.endsWith(`/${legacy}/SKILL.md`)) {
			return SUPER_INTELLEGENT_SKILL_CONTENT;
		}
	}
	return undefined;
}

export function getBuiltinSkillPromptPaths(): readonly IBuiltinPromptPath[] {
	// Expose only 'plan' and 'super-intellegent' in public slash command autocomplete
	return Array.from(_builtinSkillsMap.values())
		.filter(skill => skill.name !== 'super-intelligent')
		.map(skill => ({
			uri: getBuiltinSkillUri(skill.name),
			storage: PromptsStorage.builtIn,
			type: PromptsType.skill,
			name: skill.name,
			description: skill.description,
		}));
}
