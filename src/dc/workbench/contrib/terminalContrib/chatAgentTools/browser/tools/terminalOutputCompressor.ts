/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TerminalToolId } from '../../../../chat/common/tools/terminalToolIds.js';
import { IToolResultCompressor, IToolResultFilter, IToolResultFilterOutput } from '../../../../chat/common/tools/toolResultCompressor.js';
import { ICommandSegment, parseCommand, parseCommandHead as _parseCommandHead, segmentHasFlag, segmentHead } from './terminalCommandParser.js';
import { TerminalOutputCache } from './terminalOutputCache.js';

interface ITerminalInput {
	command?: string;
}

function isTerminalInput(input: unknown): input is ITerminalInput {
	if (typeof input !== 'object' || input === null) {
		return false;
	}
	const terminalInput = input as { command?: unknown };
	return terminalInput.command === undefined || typeof terminalInput.command === 'string';
}

export const parseCommandHead = _parseCommandHead;

function makeMatcher(opts: {
	head: string;
	sub?: string | readonly string[] | '*' | null;
	flag?: (seg: ICommandSegment) => boolean;
}) {
	const allowedSubs = opts.sub === '*' || opts.sub === undefined ? undefined
		: opts.sub === null ? null
			: typeof opts.sub === 'string' ? new Set([opts.sub])
				: new Set(opts.sub);
	return (input: unknown): boolean => {
		if (!isTerminalInput(input)) {
			return false;
		}
		const parsed = parseCommand(input.command);
		if (!parsed) {
			return false;
		}
		for (const seg of parsed.segments) {
			const head = segmentHead(seg);
			if (!head || head.head !== opts.head) {
				continue;
			}
			if (allowedSubs === null) {
				if (head.sub !== undefined) {
					continue;
				}
			} else if (allowedSubs !== undefined) {
				if (head.sub === undefined || !allowedSubs.has(head.sub)) {
					continue;
				}
			}
			if (opts.flag && !opts.flag(seg)) {
				continue;
			}
			return true;
		}
		return false;
	};
}


export const gitDiffFilter: IToolResultFilter = {
	id: 'terminal.git-diff',
	toolIds: [TerminalToolId.RunInTerminal],
	matches: (_toolId, input) => makeMatcher({ head: 'git', sub: ['diff', 'show'] })(input),
	apply(text): IToolResultFilterOutput {
		const lines = text.split('\n');
		const out: string[] = [];
		const KEEP_CONTEXT = 1;
		let contextRun = 0;
		let inBinaryOrLock = false;

		let pendingHunkHeaderIndex = -1;
		let pendingHunkOldStart = 0;
		let pendingHunkNewStart = 0;
		let pendingOldLines = 0;
		let pendingNewLines = 0;

		const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

		const flushHunk = () => {
			if (pendingHunkHeaderIndex < 0) {
				return;
			}
			out[pendingHunkHeaderIndex] = `@@ -${pendingHunkOldStart},${pendingOldLines} +${pendingHunkNewStart},${pendingNewLines} @@`;
			pendingHunkHeaderIndex = -1;
		};

		const flushContextRun = () => {
			const omitted = contextRun - KEEP_CONTEXT;
			if (omitted > 0) {
				out.push(`... ${omitted} unchanged context line${omitted === 1 ? '' : 's'} omitted ...`);
			}
			contextRun = 0;
		};

		for (const line of lines) {
			if (line.startsWith('diff --git')) {
				flushContextRun();
				flushHunk();
				inBinaryOrLock = /package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|\.snap$/.test(line);
				if (inBinaryOrLock) {
					out.push(line);
					out.push('... lockfile/snapshot diff omitted ...');
					continue;
				}
				out.push(line);
				continue;
			}
			if (inBinaryOrLock) {
				continue;
			}
			if (line.startsWith('index ') || line.startsWith('similarity index ') ||
				line.startsWith('dissimilarity index ') || line.startsWith('rename from ') ||
				line.startsWith('rename to ')) {
				continue;
			}
			const hunkMatch = HUNK_RE.exec(line);
			if (hunkMatch) {
				flushContextRun();
				flushHunk();
				pendingHunkOldStart = parseInt(hunkMatch[1], 10);
				pendingHunkNewStart = parseInt(hunkMatch[3], 10);
				pendingOldLines = 0;
				pendingNewLines = 0;
				pendingHunkHeaderIndex = out.length;
				out.push(line);
				continue;
			}
			if (line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('Binary files ')) {
				flushContextRun();
				flushHunk();
				out.push(line);
				continue;
			}
			if (line.startsWith('+')) {
				flushContextRun();
				out.push(line);
				pendingNewLines++;
				continue;
			}
			if (line.startsWith('-')) {
				flushContextRun();
				out.push(line);
				pendingOldLines++;
				continue;
			}
			if (!line.startsWith(' ')) {
				flushContextRun();
				out.push(line);
				continue;
			}
			contextRun++;
			if (contextRun <= KEEP_CONTEXT) {
				out.push(line);
				pendingOldLines++;
				pendingNewLines++;
			}
		}
		flushContextRun();
		flushHunk();

		const result = out.join('\n');
		return { text: result, compressed: result.length < text.length };
	},
};

export const gitLogFilter: IToolResultFilter = {
	id: 'terminal.git-log',
	toolIds: [TerminalToolId.RunInTerminal],
	matches: (_toolId, input) => makeMatcher({ head: 'git', sub: ['log', 'reflog', 'shortlog'] })(input),
	apply(text): IToolResultFilterOutput {
		const lines = text.split('\n');
		const out: string[] = [];
		let blankRun = 0;
		for (const line of lines) {
			if (line.trim() === '') {
				blankRun++;
				if (blankRun <= 1) {
					out.push(line);
				}
				continue;
			}
			blankRun = 0;
			out.push(line);
		}
		while (out.length > 0 && out[out.length - 1].trim() === '') {
			out.pop();
		}
		const result = out.join('\n');
		return { text: result, compressed: result.length < text.length };
	},
};

export const gitStatusFilter: IToolResultFilter = {
	id: 'terminal.git-status',
	toolIds: [TerminalToolId.RunInTerminal],
	matches: (_toolId, input) => makeMatcher({ head: 'git', sub: 'status' })(input),
	apply(text): IToolResultFilterOutput {
		const HINT_PATTERNS = [
			/^\s*\(use "git add.*"\s+to.*\)\s*$/,
			/^\s*\(use "git restore.*"\s+to.*\)\s*$/,
			/^\s*\(use "git rm --cached.*"\s+to.*\)\s*$/,
			/^\s*\(use "git push" to publish.*\)\s*$/,
			/^\s*\(commit or discard.*\)\s*$/,
		];
		const lines = text.split('\n');
		const out: string[] = [];
		for (const line of lines) {
			if (HINT_PATTERNS.some(re => re.test(line))) {
				continue;
			}
			out.push(line);
		}
		const result = out.join('\n');
		return { text: result, compressed: result.length < text.length };
	},
};


export const lsFilter: IToolResultFilter = {
	id: 'terminal.ls',
	toolIds: [TerminalToolId.RunInTerminal],
	matches(_toolId, input) {
		if (!isTerminalInput(input)) {
			return false;
		}
		const parsed = parseCommand(input.command);
		if (!parsed) {
			return false;
		}
		for (const seg of parsed.segments) {
			const head = segmentHead(seg);
			if (head?.head !== 'ls') {
				continue;
			}
			if (segmentHasFlag(seg, ['l'])) {
				return true;
			}
		}
		return false;
	},
	apply(text): IToolResultFilterOutput {
		const lines = text.split('\n');
		const out: string[] = [];
		const longRe = /^[-dlcbpsDLCBPS][rwx\-tTsS@+.]{9,}\s+\d+\s+\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+(.+)$/;
		for (const line of lines) {
			if (!line.trim()) {
				continue;
			}
			if (line.startsWith('total ')) {
				continue;
			}
			const m = longRe.exec(line);
			if (m) {
				const isDir = line.startsWith('d');
				out.push(isDir ? m[1] + '/' : m[1]);
			} else {
				out.push(line);
			}
		}
		const result = out.join('\n');
		return { text: result, compressed: result.length < text.length };
	},
};

const MAX_LIST_LINES = 200;

function capLines(text: string, max: number, label: string): IToolResultFilterOutput {
	const lines = text.split('\n');
	if (lines.length <= max + 1) {
		return { text, compressed: false };
	}
	const kept = lines.slice(0, max);
	const omitted = lines.length - max;
	kept.push(`... ${omitted} ${label} lines omitted ...`);
	const result = kept.join('\n');
	return { text: result, compressed: result.length < text.length };
}

export const findFilter: IToolResultFilter = {
	id: 'terminal.find',
	toolIds: [TerminalToolId.RunInTerminal],
	matches(_toolId, input) {
		if (!isTerminalInput(input)) {
			return false;
		}
		const parsed = parseCommand(input.command);
		if (!parsed) {
			return false;
		}
		return parsed.segments.some(seg => segmentHead(seg)?.head === 'find');
	},
	apply: (text) => capLines(text, MAX_LIST_LINES, 'find result'),
};

export const grepFilter: IToolResultFilter = {
	id: 'terminal.grep',
	toolIds: [TerminalToolId.RunInTerminal],
	matches(_toolId, input) {
		if (!isTerminalInput(input)) {
			return false;
		}
		const parsed = parseCommand(input.command);
		if (!parsed) {
			return false;
		}
		return parsed.segments.some(seg => {
			const head = segmentHead(seg);
			return head !== undefined && (head.head === 'grep' || head.head === 'rg' || head.head === 'ack' || head.head === 'ag');
		});
	},
	apply: (text) => capLines(text, MAX_LIST_LINES, 'matching'),
};

export const treeFilter: IToolResultFilter = {
	id: 'terminal.tree',
	toolIds: [TerminalToolId.RunInTerminal],
	matches(_toolId, input) {
		if (!isTerminalInput(input)) {
			return false;
		}
		const parsed = parseCommand(input.command);
		if (!parsed) {
			return false;
		}
		return parsed.segments.some(seg => segmentHead(seg)?.head === 'tree');
	},
	apply: (text) => capLines(text, MAX_LIST_LINES, 'tree'),
};


function compressTestRunnerOutput(text: string): IToolResultFilterOutput {
	const lines = text.split('\n');
	const dropPatterns: RegExp[] = [
		/^\s*PASS\s+\S+/,
		/^\s*ok\s+\d+\s+/,
		/^\s*\u2713\s/,
		/^\s*[.sSEFx]{10,}\s*$/,
		/^test\s.+ \.\.\. ok\s*$/,
		/^running \d+ tests?$/i,
	];
	const out: string[] = [];
	for (const line of lines) {
		if (dropPatterns.some(re => re.test(line))) {
			continue;
		}
		out.push(line);
	}
	const result = out.join('\n');
	return { text: result, compressed: result.length < text.length };
}

export const testRunnerFilter: IToolResultFilter = {
	id: 'terminal.test-runner',
	toolIds: [TerminalToolId.RunInTerminal],
	matches(_toolId, input) {
		if (!isTerminalInput(input)) {
			return false;
		}
		const parsed = parseCommand(input.command);
		if (!parsed) {
			return false;
		}
		for (const seg of parsed.segments) {
			const head = segmentHead(seg);
			if (!head) {
				continue;
			}
			if (head.head === 'pytest' || head.head === 'jest' || head.head === 'vitest' || head.head === 'playwright' || head.head === 'mocha') {
				return true;
			}
			if (head.head === 'cargo' && head.sub && /^(test|nextest)$/.test(head.sub)) {
				return true;
			}
			if (head.head === 'go' && head.sub === 'test') {
				return true;
			}
			if ((head.head === 'npm' || head.head === 'pnpm' || head.head === 'yarn') && head.sub === 'test') {
				return true;
			}
			if (head.head === 'npx' && head.sub && /^(jest|vitest|playwright|mocha)$/.test(head.sub)) {
				return true;
			}
		}
		return false;
	},
	apply: (text) => compressTestRunnerOutput(text),
};


function compressBuildOutput(text: string): IToolResultFilterOutput {
	const dropPatterns: RegExp[] = [
		/^\s*Compiling\s+\S+\s+v\S+/,
		/^\s*Downloading\s+\S+/,
		/^\s*Downloaded\s+\S+/,
		/^\s*Updating\s+crates\.io\s+index/,
		/^\s*Finished\s+(dev|release|test)/,
		/^make\[\d+\]: (Entering|Leaving) directory/,
		/^Download(ed|ing) https?:/,
		/^\[INFO\] Downloading from /,
		/^\[INFO\] Downloaded from /,
		/^> Task :/,
	];
	const lines = text.split('\n');
	const out: string[] = [];
	for (const line of lines) {
		if (dropPatterns.some(re => re.test(line))) {
			continue;
		}
		out.push(line);
	}
	const result = out.join('\n');
	return { text: result, compressed: result.length < text.length };
}

export const buildToolFilter: IToolResultFilter = {
	id: 'terminal.build-tool',
	toolIds: [TerminalToolId.RunInTerminal],
	matches(_toolId, input) {
		if (!isTerminalInput(input)) {
			return false;
		}
		const parsed = parseCommand(input.command);
		if (!parsed) {
			return false;
		}
		for (const seg of parsed.segments) {
			const head = segmentHead(seg);
			if (!head) {
				continue;
			}
			if (head.head === 'cargo' && head.sub && /^(build|check|clippy)$/.test(head.sub)) {
				return true;
			}
			if (head.head === 'go' && (head.sub === 'build' || head.sub === 'vet')) {
				return true;
			}
			if (head.head === 'make' || head.head === 'tsc' || head.head === 'gradle' || head.head === 'mvn') {
				return true;
			}
			if (head.head === 'dotnet' && head.sub === 'build') {
				return true;
			}
		}
		return false;
	},
	apply: (text) => compressBuildOutput(text),
};


function compressLinterOutput(text: string): IToolResultFilterOutput {
	const lines = text.split('\n');
	const dropPatterns: RegExp[] = [
		/^\s*Success: no issues found\s*$/i,
		/^\s*All checks passed\.?\s*$/i,
		/^\s*Success:\s*0 errors/i,
	];
	const out: string[] = [];
	for (const line of lines) {
		if (dropPatterns.some(re => re.test(line))) {
			continue;
		}
		out.push(line);
	}
	const result = out.join('\n');
	return { text: result, compressed: result.length < text.length };
}

export const linterFilter: IToolResultFilter = {
	id: 'terminal.linter',
	toolIds: [TerminalToolId.RunInTerminal],
	matches(_toolId, input) {
		if (!isTerminalInput(input)) {
			return false;
		}
		const parsed = parseCommand(input.command);
		if (!parsed) {
			return false;
		}
		for (const seg of parsed.segments) {
			const head = segmentHead(seg);
			if (!head) {
				continue;
			}
			if (head.head === 'eslint' || head.head === 'ruff' || head.head === 'mypy' || head.head === 'prettier' || head.head === 'rubocop' || head.head === 'golangci-lint') {
				return true;
			}
			if (head.head === 'cargo' && head.sub === 'clippy') {
				return true;
			}
			if (head.head === 'npx' && head.sub && /^(eslint|prettier|tsc)$/.test(head.sub)) {
				return true;
			}
		}
		return false;
	},
	apply: (text) => compressLinterOutput(text),
};


export const npmInstallFilter: IToolResultFilter = {
	id: 'terminal.npm-install',
	toolIds: [TerminalToolId.RunInTerminal],
	matches(_toolId, input) {
		if (!isTerminalInput(input)) {
			return false;
		}
		const parsed = parseCommand(input.command);
		if (!parsed) {
			return false;
		}
		for (const seg of parsed.segments) {
			const head = segmentHead(seg);
			if (!head) {
				continue;
			}
			if (head.head === 'npm' && head.sub && /^(install|i|ci|add)$/.test(head.sub)) {
				return true;
			}
			if (head.head === 'yarn' || head.head === 'pnpm') {
				if (head.sub === 'install' || head.sub === 'add' || head.sub === 'i') {
					return true;
				}
				if (head.sub === undefined) {
					return true;
				}
			}
		}
		return false;
	},
	apply(text): IToolResultFilterOutput {
		const lines = text.split('\n');
		const dropPatterns: RegExp[] = [
			/^npm warn deprecated /i,
			/^\s*\[#+>?\s*\] /,
			/^npm http /i,
			/^npm timing /i,
			/^npm sill /i,
			/^npm verb /i,
			/^\s*\d+ packages? are looking for funding/i,
			/run `npm fund`/i,
			/^Run `npm audit/i,
		];
		const out: string[] = [];
		for (const line of lines) {
			if (dropPatterns.some(re => re.test(line))) {
				continue;
			}
			out.push(line);
		}
		const result = out.join('\n');
		return { text: result, compressed: result.length < text.length };
	},
};


export const envFilter: IToolResultFilter = {
	id: 'terminal.env',
	toolIds: [TerminalToolId.RunInTerminal],
	matches(_toolId, input) {
		if (!isTerminalInput(input)) {
			return false;
		}
		const parsed = parseCommand(input.command);
		if (!parsed) {
			return false;
		}
		for (const seg of parsed.segments) {
			const head = segmentHead(seg);
			if (head?.head === 'printenv') {
				return true;
			}
			if (head === undefined && seg.wrappers.length > 0 && seg.wrappers[seg.wrappers.length - 1] === 'env' && seg.tokens.length === 0) {
				return true;
			}
		}
		return false;
	},
	apply(text): IToolResultFilterOutput {
		const lines = text.split('\n').filter(l => l.trim() !== '');
		const unique = Array.from(new Set(lines)).sort();
		const result = unique.join('\n');
		return { text: result, compressed: result.length < text.length };
	},
};

export function registerTerminalCompressors(compressor: IToolResultCompressor): void {
	compressor.registerFilter(gitDiffFilter);
	compressor.registerFilter(gitLogFilter);
	compressor.registerFilter(gitStatusFilter);
	compressor.registerFilter(lsFilter);
	compressor.registerFilter(findFilter);
	compressor.registerFilter(grepFilter);
	compressor.registerFilter(treeFilter);
	compressor.registerFilter(testRunnerFilter);
	compressor.registerFilter(buildToolFilter);
	compressor.registerFilter(linterFilter);
	compressor.registerFilter(npmInstallFilter);
	compressor.registerFilter(envFilter);

	compressor.registerCache(new TerminalOutputCache());
}
