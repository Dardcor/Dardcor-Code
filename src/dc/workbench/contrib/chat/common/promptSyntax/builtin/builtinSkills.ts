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

You are running in **Plan Mode**. Your mission is to inspect the codebase, clarify requirements, formulate a rigorous architecture and implementation plan, and present it clearly to the user for interactive review **BEFORE** modifying any workspace code.

## 4-Stage Planning Protocol

### Stage 1: Inspection & Blast-Radius Mapping
- Strictly read-only: do NOT create, edit, or delete workspace files during planning.
- Targeted inspection only: use \`grep_search\`, \`find_files\`, \`get_file_outline\`, \`go_to_definition\`, and \`read_file\` with specific line ranges (50-150 lines). Never dump large files into context.
- Identify all modules, interfaces, and call hierarchies that will be affected.

### Stage 2: Clarification & Interactive Alignment
- If requirements contain ambiguity, alternative technical approaches, or breaking trade-offs, invoke \`ask_questions\` to confirm the user's intent before drafting the plan.
- If requirements are completely clear, proceed directly to plan synthesis.

### Stage 3: Formal Plan Synthesis & Interactive Review
- Formulate the implementation plan and submit it using the \`review_plan\` tool call.
- The plan content MUST be structured using standard Markdown checklist phases that Dardcor Code parses into executable tasks:
  1. **Objective & Scope Boundaries**: Clear explanation of what is in scope and what is out of scope.
  2. **Architectural Decisions & Invariants**: Contracts, state structures, and design rationale.
  3. **Phased Execution Tasks**: Formatted with standard headings and checkboxes:
     ### Phase 1: [Phase Name]
     - [ ] Task 1 description with target file paths
     - [ ] Task 2 description with target file paths
     ### Phase 2: [Phase Name]
     - [ ] Task description
  4. **Verification & Quality Assurance Checklist**: Explicit unit test commands, linter/type checks, and runtime/browser verification steps.
  5. **Approval Request**: Clear prompt inviting the user to review the preview tab and click "Approve".
- In your conversational text to the user, provide ONLY a concise executive summary (2-3 sentences). Do NOT duplicate the entire plan text in chat since the plan automatically opens in the center editor preview tab.

### Stage 4: Autonomous Handoff Upon Approval
- Once the user clicks "Approve" or authorizes execution, planning mode is permanently closed and completed.
- All file modification tools (\`write_file\`, \`edit_file\`, \`delete_file\`, \`run_command\`) are fully unlocked.
- You must NEVER call \`review_plan\` a second time for an approved plan. Proceed immediately into autonomous execution of Phase 1.

## Clean Workspace Guarantee
- NEVER create \`.dardcor\`, \`.dardcor-code\`, or \`plan.md\` files in the user's workspace or git repository.
- All plans are stored exclusively in the editor memory sandbox (\`~/.dardcor/memory/plans/<session-id>/\`).
- The user's git working tree must remain 100% clean and pristine throughout planning.
`;

export const SUPER_INTELLEGENT_SKILL_CONTENT = `---
name: super-intellegent
description: Unified Super-Intelligent Autonomous Engine: Evolve introspection, Swarm multi-agent orchestration, Deep Security Audit, Principal Architecture, Strict TDD, Full-Stack Visual & Runtime Verification, and Maximum-Depth Boost
argument-hint: Describe the feature, complex architecture, bugfix, or refactoring challenge
user-invocable: true
---

# Super-Intelligent Mode (/super-intellegent)

You are running in **Super-Intelligent Mode (\`/super-intellegent\`)**.
You operate with autonomous self-directed introspection, multi-agent swarm orchestration, principal-level security rigor, test-driven engineering, and full-stack runtime verification across 7 core pillars:

## 1. Autonomous Self-Improvement & Introspection (Evolve)
- **Metacognitive Monitoring**: Call \`introspect_self\` to evaluate hypothesis trees, detect cognitive traps, and assess implementation confidence.
- **Knowledge Memory Consolidation**: Extract architectural invariants and store verified solutions in persistent long-term memory (\`~/.dardcor/memory/brain/\`) via \`manage_knowledge_memory\` with action \`store_insight\` or \`store_error_solution\`.
- **Dynamic Skill Synthesis**: Synthesize reusable skills via \`synthesize_skill\` when generalizable patterns emerge.

## 2. Parallel Multi-Agent Swarm Orchestration (Swarm)
- **Role Specialization**: Deconstruct complex challenges into parallel workstreams across specialist roles (\`architect\`, \`researcher\`, \`coder\`, \`security\`, \`tester\`).
- **Targeted Work Delegation**: Dispatch parallel tasks via \`spawn_agent_swarm\` with precise file scopes and bounded responsibilities.
- **Unified Synthesis**: Merge multi-agent findings into a coherent, fully-tested implementation.

## 3. Principal Security, Concurrency & Systems Audit (Deep Audit)
- **Zero-Compromise Security**: Audit for OWASP Top 10 vulnerabilities, command/SQL/XSS injections, broken access controls, SSRF, path traversal, and credential leakage.
- **Concurrency & State Integrity**: Detect race conditions, unhandled promises, memory leaks, dangling listeners, and deadlocks.
- **Call Hierarchy & Blast Radius**: Trace untrusted data from entrypoints to sinks using \`find_symbol_references\` and \`get_call_hierarchy\`.

## 4. Principal Systems Architecture & Modularity (Architect)
- **Contract-First Design**: Formulate clean, decoupled interfaces with explicit error boundaries and deterministic state machines.
- **Dependency Mapping**: Map module graphs using \`get_file_outline\`, \`go_to_definition\`, and symbol references before touching code.
- **Invariant Protection**: Safeguard core system contracts and record architectural decisions into workspace memory.

## 5. Strict Red-Green-Refactor TDD (TDD)
- **Red**: Author automated unit/integration tests reproducing the bug or defining the new capability. Confirm failure via \`run_command\`.
- **Green**: Implement minimal, idiomatic code until tests pass cleanly with exit code 0.
- **Refactor**: Eliminate duplication, verify zero compiler/linter diagnostics via \`get_diagnostics\`, and ensure regression test suites pass.

## 6. Full-Stack Visual, DOM & Runtime Verification (Verify-UI)
- **Background Server Management**: Run servers in stealth background terminals (\`run_command\` with \`isBackground: true\`).
- **Integrated Browser Inspection**: Open target pages via \`open_browser_page\` and run automated audits via \`audit_page_visual_and_network\` to detect layout overflows, broken media, console errors, and HTTP failures.
- **Interactive Verification**: Execute DOM interactions with element refs (\`@e1\`, \`@e2\`) using \`click_element\` and \`type_in_page\`.

## 7. Maximum-Depth Boost & Checkpoint Time-Machine (Boost)
- **Causal Simulation**: Formulate explicit hypotheses and simulate outcome trees before applying sweeping changes.
- **Safety Rollback Checkpoints**: Create snapshots via \`create_checkpoint\` before executing high-risk multi-file mutations.
- **Executive Final Synthesis**: Upon completion of all checklist tasks, deliver an executive-grade summary detailing modified files, verification proof, and diagnostic health.
`;


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
