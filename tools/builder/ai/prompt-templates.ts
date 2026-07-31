/**
 * Dardcor Code - Built-in AI Prompt Templates (Task 916)
 *
 * Curated prompt templates (`code_explain`, `fix_bugs`, `generate_tests`,
 * `refactor_code`, `review_code`) rendered with a `{{placeholder}}`
 * substitution engine. Templates are role-structured system+user messages
 * ready for the AI provider bridge.
 */

import type { AiMessage } from './ai-provider-bridge.js';

export interface PromptTemplate {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly parameters: readonly string[];
	readonly system: string;
	readonly user: string;
}

export const promptTemplates: readonly PromptTemplate[] = [
	{
		id: 'code_explain',
		name: 'Explain Code',
		description: 'Explains the selected code snippet line by line.',
		parameters: ['code', 'language'],
		system: 'You are a senior software engineer mentor. Explain code clearly and concisely. Use bullet points for line-by-line explanation and note any bugs or anti-patterns you spot.',
		user: 'Please explain the following {{language}} code:\n\n```{{language}}\n{{code}}\n```\n\nInclude: 1) what it does overall, 2) line-by-line highlights, 3) potential issues.',
	},
	{
		id: 'fix_bugs',
		name: 'Fix Bugs',
		description: 'Diagnoses and fixes bugs in the provided code and error output.',
		parameters: ['code', 'error', 'language'],
		system: 'You are a meticulous debugging engineer. Identify the root cause of the reported error, propose the minimal fix, and show the corrected code block. Never change unrelated behavior.',
		user: 'The following {{language}} code has a bug:\n\n```{{language}}\n{{code}}\n```\n\nError output:\n```\n{{error}}\n```\n\nRespond with: 1) root cause, 2) the fix as a diff or full corrected snippet, 3) how you verified it.',
	},
	{
		id: 'generate_tests',
		name: 'Generate Tests',
		description: 'Writes unit tests for the given code using the project test harness.',
		parameters: ['code', 'language', 'framework'],
		system: 'You are a testing expert. Generate thorough unit tests covering happy paths, edge cases, and failure modes. Match the requested framework conventions and keep tests deterministic.',
		user: 'Generate {{framework}} unit tests for the following {{language}} code:\n\n```{{language}}\n{{code}}\n```\n\nCover: normal inputs, empty/edge inputs, and error cases. Include assertions with meaningful messages.',
	},
	{
		id: 'refactor_code',
		name: 'Refactor Code',
		description: 'Suggests a cleaner refactor of the code while preserving behavior.',
		parameters: ['code', 'language', 'goal'],
		system: 'You are a code quality specialist. Refactor the code to improve readability and maintainability. Preserve exact behavior unless the user asks otherwise. Prefer small, idiomatic changes.',
		user: 'Refactor this {{language}} code with the goal: {{goal}}\n\n```{{language}}\n{{code}}\n```\n\nShow the refactored code and a short list of the changes you made.',
	},
	{
		id: 'review_code',
		name: 'Review Code',
		description: 'Performs a structured code review with severity-ranked findings.',
		parameters: ['code', 'language'],
		system: 'You are a strict code reviewer. Produce a structured review: correctness, security, performance, readability. Rank findings by severity (critical/warning/nit) and cite line ranges.',
		user: 'Review this {{language}} code:\n\n```{{language}}\n{{code}}\n```\n\nOutput format:\n- [critical|warning|nit] issue description (lines X-Y)\n- suggestion\nEnd with an overall verdict.',
	},
];

export function renderTemplate(template: PromptTemplate, vars: Record<string, string>): { system: string; user: string } {
	const render = (text: string): string =>
		text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
			const value = vars[key];
			return value !== undefined ? value : match;
		});
	return { system: render(template.system), user: render(template.user) };
}

export function renderTemplateMessages(template: PromptTemplate, vars: Record<string, string>): AiMessage[] {
	const { system, user } = renderTemplate(template, vars);
	return [
		{ role: 'system', content: system },
		{ role: 'user', content: user },
	];
}

export function getTemplate(id: string): PromptTemplate {
	const template = promptTemplates.find(t => t.id === id);
	if (!template) {
		throw new Error(`unknown prompt template: ${id} (available: ${promptTemplates.map(t => t.id).join(', ')})`);
	}
	return template;
}

export function listTemplates(): ReadonlyArray<{ id: string; name: string; description: string; parameters: readonly string[] }> {
	return promptTemplates.map(({ id, name, description, parameters }) => ({ id, name, description, parameters }));
}
