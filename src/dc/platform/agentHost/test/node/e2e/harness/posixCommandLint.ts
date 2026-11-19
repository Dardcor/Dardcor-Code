/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface IRecordedCommand {
	readonly command: string;
	readonly toolName: string;
}

export interface IPosixCommandFinding {
	readonly command: string;
	readonly toolName: string;
	readonly reason: string;
}

export function getRecordedShellCommand(input: { readonly command?: unknown; readonly cmd?: unknown } | undefined): string | undefined {
	if (typeof input?.command === 'string' && input.command) {
		return input.command;
	}
	return typeof input?.cmd === 'string' && input.cmd ? input.cmd : undefined;
}

interface IPosixPattern {
	readonly pattern: RegExp;
	readonly reason: string;
}

const COMMAND_POSITION = String.raw`(?:^|[|;]|&&|\|\|)\s*`;

const POSIX_PATTERNS: readonly IPosixPattern[] = [
	{
		pattern: new RegExp(`${COMMAND_POSITION}(?:ls|cat|rm|mv|cp|touch|wc|head|tail|grep|sed|awk|find|xxd|printf|chmod|chown|du|df|which|basename|dirname|mkdir|rmdir|ln|tee|sort|uniq|cut|tr|test|\\[|export|unset|source|\\.)\\b`),
		reason: 'uses a POSIX coreutil or shell builtin that is not portable to Windows shells',
	},
	{
		pattern: /(?:^|\s)2>(?:&1|\s*\/dev\/null)/,
		reason: 'redirects stderr using POSIX syntax',
	},
	{
		pattern: /\/dev\/(?:null|stdin|stdout|stderr)\b/,
		reason: 'references a POSIX device path',
	},
	{
		pattern: /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/,
		reason: 'expands a variable using POSIX syntax',
	},
	{
		pattern: /(?:^|\s)~\//,
		reason: 'uses POSIX home-directory expansion',
	},
];

const RECORDER_PLACEHOLDER_RE = /\$\{(?:workdir|homedir|workspace|temp|user|timestamp|shell|read_shell|write_shell|stop_shell|list_shell|shell_shutdown)\}/g;

export function findPosixOnlyCommands(commands: readonly IRecordedCommand[]): IPosixCommandFinding[] {
	const findings: IPosixCommandFinding[] = [];
	for (const { command, toolName } of commands) {
		const scrubbed = command.replace(RECORDER_PLACEHOLDER_RE, 'PLACEHOLDER');
		for (const { pattern, reason } of POSIX_PATTERNS) {
			if (pattern.test(scrubbed)) {
				findings.push({ command, toolName, reason });
				break;
			}
		}
	}
	return findings;
}

export function formatPosixCommandError(fixturePath: string, findings: readonly IPosixCommandFinding[]): string {
	const lines = findings.map(finding => `  - \`${finding.command}\` (${finding.toolName}): ${finding.reason}`);
	return [
		`[capi-replay] recorded ${findings.length === 1 ? 'a shell command that is' : 'shell commands that are'} POSIX-only, so this capture cannot replay on Windows:`,
		...lines,
		'',
		`Fixture: ${fixturePath}`,
		'',
		'The model chose this command; the prompt did not. Fix the prompt, not the capture:',
		'  - If a file tool can do the job, steer the agent to it ("Use your file tools; do not run a shell command.").',
		'  - If no file tool exists (rename, delete, mkdir, listing), pin the command:',
		'    "Run exactly this shell command, with no modifications: `node -e \\"...\\"`".',
		'',
		'If the scenario genuinely cannot be portable, scope the test to a platform',
		'explicitly at its call site and say why, then set `allowPosixCommands` on the',
		'capiReplay options so this check does not fire.',
	].join('\n');
}
