/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';

export type DardcorSwarmRole = 'architect' | 'researcher' | 'coder' | 'tester' | 'security' | 'vision';

export interface IDardcorSwarmTaskInput {
	readonly role: DardcorSwarmRole | string;
	readonly task: string;
	readonly targetFiles?: string[];
}

export interface IDardcorSwarmExecutionResult {
	readonly role: string;
	readonly task: string;
	readonly durationMs: number;
	readonly status: 'completed' | 'failed';
	readonly output: string;
}

const SWARM_ROLE_SYSTEM_PROMPTS: Record<string, string> = {
	architect: 'You are the Dardcor Omega Principal Systems Architect sub-agent. Analyze system architecture, module boundaries, state flow, and scalability. Deliver concrete, actionable architectural blueprints and interface contracts with zero fluff.',
	researcher: 'You are the Dardcor Omega Deep Codebase Researcher sub-agent. Trace symbol definitions, callers, data flows, and configuration dependencies across the provided files and context. Report exact file paths, line numbers, and behavioral findings.',
	coder: 'You are the Dardcor Omega Principal Implementation Engineer sub-agent. Formulate exact, production-ready code implementations, edge-case guards, and clean refactoring patterns for the assigned task.',
	tester: 'You are the Dardcor Omega QA & Verification Engineer sub-agent. Design comprehensive unit/integration test cases, identify regression risks, boundary conditions, and exact verification commands.',
	security: 'You are the Dardcor Omega Offensive & Defensive Security Auditor sub-agent. Audit the target code and architecture for injection, SSRF, XSS, auth bypass, secret leakage, and race conditions. Provide concrete remediation patches.',
	vision: 'You are the Dardcor Omega UI/UX & Visual Systems Specialist sub-agent. Evaluate layout hierarchy, responsive behavior, CSS/DOM integrity, accessibility, and interactive states.',
};

export async function executeDardcorAgentSwarm(options: {
	readonly tasks: readonly IDardcorSwarmTaskInput[];
	readonly model: string;
	readonly routerPort: number;
	readonly routerAuthHeader: Record<string, string>;
	readonly resolveTargetUri: (relOrAbsPath: string) => URI | undefined;
	readonly fileService: IFileService;
	readonly token: CancellationToken;
}): Promise<{
	readonly summaryMarkdown: string;
	readonly results: readonly IDardcorSwarmExecutionResult[];
}> {
	const validTasks = options.tasks.slice(0, 6);
	if (validTasks.length === 0) {
		return {
			summaryMarkdown: 'No swarm tasks were provided.',
			results: [],
		};
	}

	const runSingleAgent = async (item: IDardcorSwarmTaskInput, index: number): Promise<IDardcorSwarmExecutionResult> => {
		const startMs = Date.now();
		const roleKey = String(item.role || 'researcher').toLowerCase().trim();
		const systemPrompt = SWARM_ROLE_SYSTEM_PROMPTS[roleKey] ?? SWARM_ROLE_SYSTEM_PROMPTS.researcher;

		const fileSnippets: string[] = [];
		if (Array.isArray(item.targetFiles)) {
			for (const rawPath of item.targetFiles.slice(0, 5)) {
				try {
					const uri = options.resolveTargetUri(String(rawPath));
					if (uri && await options.fileService.exists(uri)) {
						const content = (await options.fileService.readFile(uri)).value.toString();
						const numbered = content
							.split(/\r?\n/)
							.slice(0, 220)
							.map((line, idx) => `${idx + 1}: ${line}`)
							.join('\n');
						fileSnippets.push(`### File: ${rawPath}\n\`\`\`\n${numbered}\n\`\`\``);
					}
				} catch {
					// Ignore unreadable target file
				}
			}
		}

		const userPayload = [
			`### Swarm Sub-Agent Assignment (#${index + 1} — Role: ${roleKey.toUpperCase()})`,
			`**Task**: ${item.task}`,
			fileSnippets.length > 0 ? `\n### Provided Workspace File Context\n${fileSnippets.join('\n\n')}` : '',
			`\nProvide a concise, high-signal technical report with concrete findings, exact file/symbol references, and actionable recommendations.`,
		].filter(Boolean).join('\n');

		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			try { controller.abort(); } catch { }
		}, 45_000);
		const cancelListener = options.token.onCancellationRequested(() => {
			try { controller.abort(); } catch { }
		});

		try {
			const response = await fetch(`http://127.0.0.1:${options.routerPort}/v1/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...options.routerAuthHeader,
				},
				body: JSON.stringify({
					model: options.model,
					stream: false,
					temperature: 0.2,
					max_tokens: 2048,
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: userPayload },
					],
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				const errText = await response.text().catch(() => `HTTP ${response.status}`);
				return {
					role: roleKey,
					task: item.task,
					durationMs: Date.now() - startMs,
					status: 'failed',
					output: `Sub-agent HTTP ${response.status}: ${errText.slice(0, 400)}`,
				};
			}

			const data = await response.json() as any;
			const content = data?.choices?.[0]?.message?.content;
			const textOutput = typeof content === 'string' && content.trim()
				? content.trim()
				: 'Sub-agent returned an empty response.';

			return {
				role: roleKey,
				task: item.task,
				durationMs: Date.now() - startMs,
				status: 'completed',
				output: textOutput,
			};
		} catch (err: any) {
			return {
				role: roleKey,
				task: item.task,
				durationMs: Date.now() - startMs,
				status: 'failed',
				output: `Sub-agent execution error: ${err?.message || String(err)}`,
			};
		} finally {
			clearTimeout(timeoutId);
			cancelListener.dispose();
		}
	};

	const overallStart = Date.now();
	const results = await Promise.all(validTasks.map((t, idx) => runSingleAgent(t, idx)));
	const totalWallClockMs = Date.now() - overallStart;

	const sections: string[] = [
		`## Dardcor Multi-Agent Swarm Synthesis (${results.length} Parallel Specialists | ${totalWallClockMs}ms total wall-clock)`,
	];
	for (let i = 0; i < results.length; i++) {
		const res = results[i];
		sections.push(
			`### [${i + 1}] Specialist: \`${res.role.toUpperCase()}\` (${res.status.toUpperCase()} in ${res.durationMs}ms)\n` +
			`**Objective**: ${res.task}\n\n` +
			`${res.output}`
		);
	}

	return {
		summaryMarkdown: sections.join('\n\n---\n\n'),
		results,
	};
}
