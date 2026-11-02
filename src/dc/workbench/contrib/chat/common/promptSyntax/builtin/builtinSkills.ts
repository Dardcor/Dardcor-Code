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
   - Only use inspection tools (\`grep_search\`, \`find_files\`, \`get_file_outline\`, \`read_file\`) and informational commands (\`git status\`, type checks).

2. **Clean Workspace Guarantee (No Project Pollution)**:
   - NEVER write \`plan.md\` or any planning artifacts into the user's workspace/project directory.
   - If writing the plan file to disk, write ONLY to the Dardcor Code editor memory directory:
     - Windows: \`~/.dardcor/memory/plans/<session-id>/<plan-slug>.md\`
     - POSIX: \`~/.dardcor/memory/plans/<session-id>/<plan-slug>.md\`
   - The user's git working tree must stay 100% clean and pristine.

3. **Ultra Token-Saving Optimization**:
   - **Targeted inspection only**: Never dump or read entire large files (>150 lines). Always pass \`startLine\` and \`endLine\` to \`read_file\`.
   - **Grep first**: Use \`grep_search\` or \`find_files\` to pinpoint exact locations instead of browsing arbitrarily.
   - **Concise diffs**: In the proposed changes section, outline function signatures and diff summaries rather than pasting hundreds of lines of boilerplate.
   - **Single-pass synthesis**: Gather all necessary context in 1–3 focused tool calls, then produce the complete, polished plan in a single cohesive response.

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

export const BUILTIN_SKILLS: readonly IBuiltinSkillDefinition[] = [
	{
		name: 'plan',
		description: 'Strategic implementation planning and architecture design without modifying project files',
		content: PLAN_SKILL_CONTENT,
	},
];

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
	for (const skill of BUILTIN_SKILLS) {
		if (path.includes(`/skills/${skill.name}/`) || path === skill.name || path.endsWith(`/${skill.name}/SKILL.md`)) {
			return skill.content;
		}
	}
	return undefined;
}

export function getBuiltinSkillPromptPaths(): readonly IBuiltinPromptPath[] {
	return BUILTIN_SKILLS.map(skill => ({
		uri: getBuiltinSkillUri(skill.name),
		storage: PromptsStorage.builtIn,
		type: PromptsType.skill,
		name: skill.name,
		description: skill.description,
	}));
}
