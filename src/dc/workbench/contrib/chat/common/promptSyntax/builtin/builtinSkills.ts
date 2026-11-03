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

export const EVOLVE_SKILL_CONTENT = `---
name: evolve
description: Autonomous self-improvement, system introspection, memory consolidation, and reusable skill synthesis
argument-hint: Describe the domain, workflow, or capability to evolve and crystallize
user-invocable: true
---

# Evolve Mode — Autonomous Self-Improvement & Metacognitive Synthesis

You are running in **Evolve Mode (\`/evolve\`)**. Your mission is to elevate Dardcor Code's intelligence, inspect your own runtime state, consolidate architectural insights into persistent long-term memory, and synthesize reusable skills.

## Core Self-Improvement Protocol
1. **System Self-Introspection**: Call \`introspect_self\` to inspect your current cognitive phase, confidence score, active hypotheses, stealth background daemons, and learned memory store.
2. **Deep Pattern Extraction**: Use \`grep_search\`, \`find_symbol_references\`, and \`read_multiple_files\` to analyze the target architecture and identify high-leverage engineering patterns or recurring failure modes.
3. **Persistent Memory Crystallization**: Use \`manage_knowledge_memory\` (\`store_insight\` / \`store_error_solution\`) to permanently store architectural invariants, verified build/test workflows, and root-cause solutions in \`~/.dardcor/memory/brain/\`.
4. **Autonomous Skill Generation**: When a generalizable workflow is discovered or requested, call \`synthesize_skill\` to create or upgrade a reusable \`SKILL.md\` definition in \`~/.dardcor/memory/skills/\`.
`;

export const SWARM_SKILL_CONTENT = `---
name: swarm
description: Parallel Multi-Agent Swarm orchestration for large-scale research, coding, auditing, and testing
argument-hint: Describe the complex multi-domain task for the agent swarm
user-invocable: true
---

# Swarm Mode — Parallel Multi-Agent Swarm Orchestration

You are running in **Swarm Mode (\`/swarm\`)**. Decompose complex, multi-faceted tasks into parallel workstreams and dispatch them via \`spawn_agent_swarm\`.

## Swarm Decomposition Strategy
1. Partition the problem into orthogonal specialist roles (\`architect\`, \`researcher\`, \`coder\`, \`security\`, \`tester\`).
2. Invoke \`spawn_agent_swarm\` with clear, non-overlapping sub-tasks and target file scopes.
3. Synthesize the aggregated swarm intelligence into a unified implementation or architectural report, then verify all changes with \`get_diagnostics\` and test execution.
`;

export const DEEP_AUDIT_SKILL_CONTENT = `---
name: deep-audit
description: Rigorous security, performance, concurrency, and architectural vulnerability audit
argument-hint: Specify the module, directory, or full workspace to audit
user-invocable: true
---

# Deep Audit Mode — Principal Security & Systems Reliability Audit

You are running in **Deep Audit Mode (\`/deep-audit\`)**. Conduct a zero-compromise audit across:
1. **Exploitable Security Vulnerabilities**: Injection (SQL/Command/XSS/Template), broken access control, SSRF, path traversal, insecure deserialization, and credential leaks.
2. **Concurrency & State Bugs**: Race conditions, unawaited promises, stale closures, memory/disposable leaks, and deadlocks.
3. **Blast-Radius & Call Graph Analysis**: Use \`find_symbol_references\` and \`get_call_hierarchy\` to trace untrusted inputs from entrypoints to sinks.
4. **Actionable Remediation**: Provide exact file/line references, severity ratings (\`CRITICAL\`, \`HIGH\`, \`MEDIUM\`), proof-of-concept explanation, and concrete code patches.
`;

export const ARCHITECT_SKILL_CONTENT = `---
name: architect
description: Principal systems architecture design, domain modeling, and blast-radius impact analysis
argument-hint: Describe the system or refactoring architecture to design
user-invocable: true
---

# Architect Mode — Principal Systems Architecture & Blast-Radius Analysis

You are running in **Architect Mode (\`/architect\`)**.
1. Map the module dependency graph using \`get_file_outline\`, \`go_to_definition\`, \`find_symbol_references\`, and \`get_call_hierarchy\`.
2. Design clean, decoupled interfaces with explicit data contracts, failure boundaries, and state machines.
3. Record key architectural invariants into persistent workspace memory via \`manage_knowledge_memory\`.
`;

export const TDD_SKILL_CONTENT = `---
name: tdd
description: Autonomous Red-Green-Refactor Test-Driven Development workflow
argument-hint: Describe the feature or bugfix to build with strict TDD
user-invocable: true
---

# TDD Mode — Autonomous Red-Green-Refactor Engineering

You are running in **TDD Mode (\`/tdd\`)**:
1. **Red**: Write or update a focused automated test that reproduces the bug or specifies the new capability, then run it via \`run_command\` to confirm it fails for the expected reason.
2. **Green**: Implement the minimal, clean production code using \`edit_file\` or \`multi_edit_file\` until the test passes with exit code 0.
3. **Refactor**: Clean up duplication, verify zero compiler errors with \`get_diagnostics\`, and re-run the test suite.
`;

export const VERIFY_UI_SKILL_CONTENT = `---
name: verify-ui
description: Full-stack visual layout, DOM, console, network, and backend server log verification
argument-hint: Specify the URL or UI flow to inspect and verify
user-invocable: true
---

# Verify-UI Mode — Full-Stack Visual & Runtime Verification

You are running in **Verify-UI Mode (\`/verify-ui\`)**:
1. Ensure the application server is running in a stealth background terminal via \`run_command\` (\`isBackground: true\`).
2. Open the target URL in the Integrated Browser using \`open_browser_page\`.
3. Call \`audit_page_visual_and_network\` to inspect visual layout anomalies (overflow, zero-size elements, broken images, occlusion), console errors, failed network requests, and correlated backend daemon logs.
4. Exercise interactive flows using \`click_element\` and \`type_in_page\` with Vercel-style refs (\`@e1\`, \`@e2\`), verifying post-action DOM snapshots.
`;

export const BOOST_SKILL_CONTENT = `---
name: boost
description: Maximum-depth multi-perspective reasoning, causal simulation, checkpointing, and rigorous verification
argument-hint: Describe the high-complexity engineering challenge
user-invocable: true
---

# Boost Mode — Super-Intelligent Multi-Perspective Engineering

You are running in **Boost Mode (\`/boost\`)**. Activate maximum cognitive depth:
1. **Introspect & Recall**: Call \`introspect_self\` and \`manage_knowledge_memory\` (\`query_memory\`) to load relevant past lessons and workspace architecture insights.
2. **Hypothesis & Blast-Radius Mapping**: Formulate explicit hypotheses and trace all callers/callees via \`find_symbol_references\` and \`get_call_hierarchy\`.
3. **Safe Time-Machine Checkpointing**: Create a pre-change snapshot via \`create_checkpoint\` before executing complex multi-file refactors with \`batch_edit_files\` or \`multi_edit_file\`.
4. **End-to-End Verification & Memory Crystallization**: Verify via \`get_diagnostics\`, automated tests, and \`audit_page_visual_and_network\` (for web apps), then store new insights via \`manage_knowledge_memory\`.
`;

const _builtinSkillsMap = new Map<string, IBuiltinSkillDefinition>([
	['plan', { name: 'plan', description: 'Strategic implementation planning and architecture design without modifying project files', content: PLAN_SKILL_CONTENT }],
	['evolve', { name: 'evolve', description: 'Autonomous self-improvement, system introspection, memory consolidation, and reusable skill synthesis', content: EVOLVE_SKILL_CONTENT }],
	['swarm', { name: 'swarm', description: 'Parallel Multi-Agent Swarm orchestration for large-scale research, coding, auditing, and testing', content: SWARM_SKILL_CONTENT }],
	['deep-audit', { name: 'deep-audit', description: 'Rigorous security, performance, concurrency, and architectural vulnerability audit', content: DEEP_AUDIT_SKILL_CONTENT }],
	['architect', { name: 'architect', description: 'Principal systems architecture design, domain modeling, and blast-radius impact analysis', content: ARCHITECT_SKILL_CONTENT }],
	['tdd', { name: 'tdd', description: 'Autonomous Red-Green-Refactor Test-Driven Development workflow', content: TDD_SKILL_CONTENT }],
	['verify-ui', { name: 'verify-ui', description: 'Full-stack visual layout, DOM, console, network, and backend server log verification', content: VERIFY_UI_SKILL_CONTENT }],
	['boost', { name: 'boost', description: 'Maximum-depth multi-perspective reasoning, causal simulation, checkpointing, and rigorous verification', content: BOOST_SKILL_CONTENT }],
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
	return undefined;
}

export function getBuiltinSkillPromptPaths(): readonly IBuiltinPromptPath[] {
	return Array.from(_builtinSkillsMap.values()).map(skill => ({
		uri: getBuiltinSkillUri(skill.name),
		storage: PromptsStorage.builtIn,
		type: PromptsType.skill,
		name: skill.name,
		description: skill.description,
	}));
}
