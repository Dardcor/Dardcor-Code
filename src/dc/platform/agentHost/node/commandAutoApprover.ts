/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Language, Parser, Query, QueryCapture } from '@vscode/tree-sitter-wasm';
import * as fs from 'fs';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { FileAccess } from '../../../base/common/network.js';
import { escapeRegExpCharacters, regExpLeadsToEndlessLoop } from '../../../base/common/strings.js';
import { URI } from '../../../base/common/uri.js';
import { getAppNodeModulesPath } from './appNodeModules.js';
import { ILogService } from '../../log/common/log.js';
import { shouldRequireConfirmationForAutoApproveParse } from '../../terminal/common/autoApprove/autoApproveParseSafety.js';
import { gitAutoApproveRules } from '../../terminal/common/autoApprove/gitAutoApproveRules.js';
import { powershellAutoApproveRules } from '../../terminal/common/autoApprove/powershellAutoApproveRules.js';
import { SedFileWriteParser } from '../../terminal/common/autoApprove/sedFileWriteParser.js';
import { sortAutoApproveRules } from '../../terminal/common/autoApprove/sortAutoApproveRules.js';
import type { AgentHostTerminalAutoApproveRuleValue, AgentHostTerminalAutoApproveRules } from '../common/agentHostSchema.js';

const SAFE_POSIX_REDIRECT_TARGETS: ReadonlySet<string> = new Set([
	'/dev/null',
	'/dev/stdout',
	'/dev/stderr',
	'/dev/tty',
]);

function isSafeRedirectDestination(dest: string, isPowerShell?: boolean): boolean {
	let cleaned = dest.trim();
	if (cleaned.length === 0) {
		return false;
	}
	if (isPowerShell && cleaned.toLowerCase() === '$null') {
		return true;
	}
	if ((cleaned.startsWith(`'`) && cleaned.endsWith(`'`)) ||
		(cleaned.startsWith('"') && cleaned.endsWith('"'))) {
		cleaned = cleaned.slice(1, -1);
	}
	if (/^&[0-9]+-?$/.test(cleaned)) {
		return true;
	}
	return !isPowerShell && SAFE_POSIX_REDIRECT_TARGETS.has(cleaned);
}

type FileRedirectClassification =
	| { kind: 'read' }
	| { kind: 'safeWrite' }
	| { kind: 'unsafeWrite'; dest: string | undefined };

function classifyFileRedirect(redirectText: string, isPowerShell?: boolean): FileRedirectClassification {
	if (!redirectText.includes('>')) {
		return { kind: 'read' };
	}
	const destMatch = redirectText.match(/(?:[0-9]+|&|\*)?>>?\|?\s*(.+)$/);
	if (!destMatch) {
		return { kind: 'unsafeWrite', dest: undefined };
	}
	const rawDest = destMatch[1].trim();
	if (isSafeRedirectDestination(rawDest, isPowerShell)) {
		return { kind: 'safeWrite' };
	}
	let dest = rawDest;
	if ((dest.startsWith(`'`) && dest.endsWith(`'`)) ||
		(dest.startsWith('"') && dest.endsWith('"'))) {
		dest = dest.slice(1, -1);
	}
	return { kind: 'unsafeWrite', dest };
}

const pwshFlagEqualsRegex = /(^|\s)(-{1,2}[\w-]+)=/g;

function maskPwshFlagEquals(commandLine: string): string {
	return commandLine.replace(pwshFlagEqualsRegex, (_, pre, flag) => `${pre}${flag} `);
}

const pwshNoSpaceRedirectRegex = /^[0-9*]?>>?/;

export type CommandApprovalResult = 'approved' | 'denied' | 'noMatch';

export interface ICommandApprovalEvaluation {
	readonly result: CommandApprovalResult;
	readonly autoApproveRuleResolvable: boolean;
}

export interface IShouldAutoApproveOptions {
	readonly isWriteDestApproved?: (dest: string) => boolean;
	readonly autoApproveRules?: AgentHostTerminalAutoApproveRules;
	readonly language?: 'bash' | 'powershell';
}

interface IAutoApproveRule {
	readonly regex: RegExp;
	readonly regexCaseInsensitive: RegExp;
}

interface IAutoApproveRules {
	readonly allowRules: IAutoApproveRule[];
	readonly denyRules: IAutoApproveRule[];
	readonly allowCommandLineRules: IAutoApproveRule[];
	readonly denyCommandLineRules: IAutoApproveRule[];
}

const neverMatchRegex = /(?!.*)/;
const transientEnvVarRegex = /^[A-Z_][A-Z0-9_]*=/i;
const sedFileWriteParser = new SedFileWriteParser();

interface ITreeSitterResources {
	readonly parserClass: typeof Parser;
	readonly queryClass: typeof Query;
	readonly bashLanguage: PromiseSettledResult<Language>;
	readonly powershellLanguage: PromiseSettledResult<Language>;
}

let treeSitterResourcesPromise: Promise<ITreeSitterResources> | undefined;

function getTreeSitterResources(): Promise<ITreeSitterResources> {

	return treeSitterResourcesPromise ??= loadTreeSitterResources();
}

async function loadTreeSitterResources(): Promise<ITreeSitterResources> {
	const { default: TreeSitter } = await import('@vscode/tree-sitter-wasm');
	const moduleRoot = URI.joinPath(FileAccess.asFileUri(getAppNodeModulesPath()), '@vscode', 'tree-sitter-wasm', 'wasm');
	const wasmPath = URI.joinPath(moduleRoot, 'tree-sitter.wasm').fsPath;

	await TreeSitter.Parser.init({
		locateFile() {
			return wasmPath;
		}
	});

	const loadGrammar = async (fileName: string) => {
		const grammarWasm = await fs.promises.readFile(URI.joinPath(moduleRoot, fileName).fsPath);
		return TreeSitter.Language.load(new Uint8Array(grammarWasm.buffer, grammarWasm.byteOffset, grammarWasm.byteLength));
	};
	const [bashLanguage, powershellLanguage] = await Promise.allSettled([
		loadGrammar('tree-sitter-bash.wasm'),
		loadGrammar('tree-sitter-powershell.wasm'),
	]);

	return {
		parserClass: TreeSitter.Parser,
		queryClass: TreeSitter.Query,
		bashLanguage,
		powershellLanguage,
	};
}

export class CommandAutoApprover extends Disposable {

	private _fallbackRules: IAutoApproveRules | undefined;
	private _cachedRuleConfig: AgentHostTerminalAutoApproveRules | undefined;
	private _cachedRules: IAutoApproveRules | undefined;
	private _parser: Parser | undefined;
	private _bashLanguage: Language | undefined;
	private _powershellLanguage: Language | undefined;
	private _queryClass: typeof Query | undefined;
	private readonly _initPromise: Promise<void>;

	constructor(
		private readonly _logService: ILogService,
	) {
		super();
		this._initPromise = this._initTreeSitter();
	}

	initialize(): Promise<void> {
		return this._initPromise;
	}

	shouldAutoApprove(commandLine: string, options?: IShouldAutoApproveOptions): CommandApprovalResult {
		return this.evaluate(commandLine, options).result;
	}

	evaluate(commandLine: string, options?: IShouldAutoApproveOptions): ICommandApprovalEvaluation {
		const trimmed = commandLine.trimStart();
		if (trimmed.length === 0) {
			return { result: 'approved', autoApproveRuleResolvable: false };
		}

		const rules = this._compileRules(options?.autoApproveRules);
		const isPowerShell = options?.language === 'powershell';

		if (this._matchesCommandLineRule(trimmed, rules.denyCommandLineRules)) {
			return { result: 'denied', autoApproveRuleResolvable: false };
		}

		const parsed = this._extractSubCommands(trimmed, isPowerShell);
		if (!parsed) {
			this._logService.trace('[CommandAutoApprover] Command line could not be analyzed, requiring confirmation');
			return { result: 'noMatch', autoApproveRuleResolvable: false };
		}

		const hasUnapprovedRedirect = () => parsed.unsafeWriteDests.some(dest => dest === undefined || !options?.isWriteDestApproved?.(dest));

		let result = this._matchSubCommands(parsed.subCommands, rules, isPowerShell);
		if (result !== 'denied' && this._matchesCommandLineRule(trimmed, rules.allowCommandLineRules)) {
			result = 'approved';
		}
		if (result === 'approved' && hasUnapprovedRedirect()) {
			this._logService.trace('[CommandAutoApprover] Write redirection to non-approved destination, requiring confirmation');
			return { result: 'noMatch', autoApproveRuleResolvable: false };
		}
		return { result, autoApproveRuleResolvable: result === 'noMatch' && !hasUnapprovedRedirect() };
	}

	private _matchSubCommands(subCommands: string[], rules: IAutoApproveRules, isPowerShell: boolean): CommandApprovalResult {
		let allApproved = true;
		for (const subCommand of subCommands) {
			if (sedFileWriteParser.canHandle(subCommand)) {
				return 'denied';
			}
			if (transientEnvVarRegex.test(subCommand)) {
				return 'denied';
			}

			const result = this._matchSingleCommand(subCommand, rules, isPowerShell);
			if (result === 'denied') {
				return 'denied';
			}
			if (result !== 'approved') {
				allApproved = false;
			}
		}
		return allApproved ? 'approved' : 'noMatch';
	}

	private _matchSingleCommand(command: string, rules: IAutoApproveRules, isPowerShell: boolean): CommandApprovalResult {
		if (this._matchesRule(command, rules.denyRules, isPowerShell)) {
			return 'denied';
		}

		if (this._matchesRule(command, rules.allowRules, isPowerShell)) {
			return 'approved';
		}

		return 'noMatch';
	}

	private _matchesCommandLineRule(commandLine: string, rules: readonly IAutoApproveRule[]): boolean {
		return rules.some(rule => rule.regex.test(commandLine));
	}

	private _matchesRule(command: string, rules: readonly IAutoApproveRule[], isPowerShell?: boolean): boolean {
		for (const rule of rules) {
			if ((isPowerShell ? rule.regexCaseInsensitive : rule.regex).test(command)) {
				return true;
			}
			if (isPowerShell && command.startsWith('(') && rule.regexCaseInsensitive.test(command.slice(1))) {
				return true;
			}
		}
		return false;
	}


	private _extractSubCommands(commandLine: string, isPowerShell: boolean): { subCommands: string[]; unsafeWriteDests: (string | undefined)[] } | undefined {
		const language = isPowerShell ? this._powershellLanguage : this._bashLanguage;
		if (!this._parser || !language || !this._queryClass) {
			return undefined;
		}

		try {
			this._parser.setLanguage(language);
			const masked = isPowerShell ? maskPwshFlagEquals(commandLine) : commandLine;
			const tree = this._parser.parse(masked);
			if (!tree) {
				return undefined;
			}

			try {
				if (shouldRequireConfirmationForAutoApproveParse(isPowerShell ? 'powershell' : 'bash', tree.rootNode.hasError)) {
					this._logService.trace('[CommandAutoApprover] PowerShell parse contains errors, requiring confirmation');
					return undefined;
				}
				const query = new this._queryClass(language, isPowerShell
					? '(command) @command (redirection) @redirection (generic_token) @generic_token (assignment_expression) @unanalyzable (invokation_expression) @unanalyzable'
					: '(command) @command (file_redirect) @file_redirect (heredoc_redirect) @heredoc_redirect (herestring_redirect) @herestring_redirect (variable_assignment) @unanalyzable (declaration_command) @unanalyzable');
				const captures: QueryCapture[] = query.captures(tree.rootNode);
				const subCommands: string[] = [];
				const unsafeWriteDests: (string | undefined)[] = [];
				let unanalyzableType: string | undefined;
				for (const capture of captures) {
					const text = masked === commandLine ? capture.node.text : commandLine.substring(capture.node.startIndex, capture.node.endIndex);
					if (capture.name === 'command') {
						subCommands.push(text);
					} else if (capture.name === 'unanalyzable' && (capture.node.type !== 'variable_assignment' || capture.node.parent?.type !== 'command')) {
						unanalyzableType ??= capture.node.type;
					} else if (capture.name === 'file_redirect' || capture.name === 'redirection' || (capture.name === 'generic_token' && pwshNoSpaceRedirectRegex.test(text))) {
						const cls = classifyFileRedirect(text, isPowerShell);
						if (cls.kind === 'unsafeWrite') {
							unsafeWriteDests.push(cls.dest);
						}
					} else if (capture.name === 'heredoc_redirect' || capture.name === 'herestring_redirect') {
					}
				}
				query.delete();

				if (unanalyzableType) {
					this._logService.trace(`[CommandAutoApprover] Command line contains an unanalyzable ${unanalyzableType}, requiring confirmation`);
					return undefined;
				}
				return subCommands.length > 0 || unsafeWriteDests.length > 0 ? { subCommands, unsafeWriteDests } : undefined;
			} finally {
				tree.delete();
			}
		} catch (err) {
			this._logService.warn('[CommandAutoApprover] Tree-sitter parsing failed', err);
			return undefined;
		}
	}

	private async _initTreeSitter(): Promise<void> {
		try {
			const resources = await getTreeSitterResources();

			if (this._store.isDisposed) {
				return;
			}

			const parser = new resources.parserClass();
			this._register(toDisposable(() => {
				try {
					parser.delete();
				} catch {
				}
			}));

			this._parser = parser;
			this._queryClass = resources.queryClass;
			if (resources.bashLanguage.status === 'fulfilled') {
				this._bashLanguage = resources.bashLanguage.value;
			} else {
				this._logService.warn('[CommandAutoApprover] Failed to load the bash grammar; bash commands will require confirmation', resources.bashLanguage.reason);
			}
			if (resources.powershellLanguage.status === 'fulfilled') {
				this._powershellLanguage = resources.powershellLanguage.value;
			} else {
				this._logService.warn('[CommandAutoApprover] Failed to load the PowerShell grammar; PowerShell commands will require confirmation', resources.powershellLanguage.reason);
			}
			this._logService.info(`[CommandAutoApprover] Tree-sitter initialized (bash=${this._bashLanguage ? 'available' : 'unavailable'}, powershell=${this._powershellLanguage ? 'available' : 'unavailable'})`);
		} catch (err) {
			this._logService.warn('[CommandAutoApprover] Failed to initialize tree-sitter', err);
		}
	}


	private _compileRules(ruleConfig: AgentHostTerminalAutoApproveRules | undefined): IAutoApproveRules {
		if (!ruleConfig) {
			if (!this._fallbackRules) {
				this._fallbackRules = this._compileRuleEntries(DEFAULT_TERMINAL_AUTO_APPROVE_RULES);
			}
			return this._fallbackRules;
		}

		if (this._cachedRuleConfig === ruleConfig && this._cachedRules) {
			return this._cachedRules;
		}

		this._cachedRuleConfig = ruleConfig;
		this._cachedRules = this._compileRuleEntries(ruleConfig);
		return this._cachedRules;
	}

	private _compileRuleEntries(ruleConfig: Readonly<Record<string, AgentHostTerminalAutoApproveRuleValue>>): IAutoApproveRules {
		const allowRules: IAutoApproveRule[] = [];
		const denyRules: IAutoApproveRule[] = [];
		const allowCommandLineRules: IAutoApproveRule[] = [];
		const denyCommandLineRules: IAutoApproveRule[] = [];

		for (const [key, value] of Object.entries(ruleConfig)) {
			const regex = convertAutoApproveEntryToRegex(key);
			const rule = {
				regex,
				regexCaseInsensitive: regex.flags.includes('i') ? regex : new RegExp(regex.source, regex.flags + 'i'),
			};
			if (value === true) {
				allowRules.push(rule);
			} else if (value === false) {
				denyRules.push(rule);
			} else if (value && typeof value === 'object' && typeof value.approve === 'boolean') {
				if (value.approve) {
					if (value.matchCommandLine === true) {
						allowCommandLineRules.push(rule);
					} else {
						allowRules.push(rule);
					}
				} else {
					if (value.matchCommandLine === true) {
						denyCommandLineRules.push(rule);
					} else {
						denyRules.push(rule);
					}
				}
			}
		}

		return { allowRules, denyRules, allowCommandLineRules, denyCommandLineRules };
	}
}


function convertAutoApproveEntryToRegex(value: string): RegExp {
	const regexMatch = value.match(/^\/(?<pattern>.+)\/(?<flags>[dgimsuvy]*)$/);
	const regexPattern = regexMatch?.groups?.pattern;
	if (regexPattern) {
		let flags = regexMatch.groups?.flags;
		if (flags) {
			flags = flags.replaceAll('g', '');
		}

		if (regexPattern === '.*') {
			return new RegExp(regexPattern);
		}

		try {
			const regex = new RegExp(regexPattern, flags || undefined);
			if (regExpLeadsToEndlessLoop(regex)) {
				return neverMatchRegex;
			}
			return regex;
		} catch {
			return neverMatchRegex;
		}
	}

	if (value === '') {
		return neverMatchRegex;
	}

	let sanitizedValue: string;

	if (value.includes('/') || value.includes('\\')) {
		let pattern = value.replace(/[/\\]/g, '%%PATH_SEP%%');
		pattern = escapeRegExpCharacters(pattern);
		pattern = pattern.replace(/%%PATH_SEP%%*/g, '[/\\\\]');
		sanitizedValue = `^(?:\\.[/\\\\])?${pattern}`;
	} else {
		sanitizedValue = escapeRegExpCharacters(value);
	}

	return new RegExp(`^${sanitizedValue}\\b`);
}


const DEFAULT_TERMINAL_AUTO_APPROVE_RULES: Readonly<Record<string, AgentHostTerminalAutoApproveRuleValue>> = {
	cd: true,
	echo: true,
	ls: true,
	dir: true,
	pwd: true,
	cat: true,
	head: true,
	tail: true,
	findstr: true,
	wc: true,
	tr: true,
	cut: true,
	cmp: true,
	which: true,
	basename: true,
	dirname: true,
	realpath: true,
	readlink: true,
	stat: true,
	file: true,
	od: true,
	du: true,
	df: true,
	sleep: true,
	nl: true,

	grep: true,

	...gitAutoApproveRules,

	'/^docker\\s+(ps|images|info|version|inspect|logs|top|stats|port|diff|search|events)\\b/': true,
	'/^docker\\s+(container|image|network|volume|context|system)\\s+(ls|ps|inspect|history|show|df|info)\\b/': true,
	'/^docker\\s+compose\\s+(ps|ls|top|logs|images|config|version|port|events)\\b/': true,

	...powershellAutoApproveRules,

	'/^npm\\s+(ls|list|outdated|view|info|show|explain|why|root|prefix|bin|search|doctor|fund|repo|bugs|docs|home|help(-search)?)\\b/': true,
	'/^npm\\s+config\\s+(list|get)\\b/': true,
	'/^npm\\s+pkg\\s+get\\b/': true,
	'/^npm\\s+audit$/': true,
	'/^npm\\s+cache\\s+verify\\b/': true,
	'/^yarn\\s+(list|outdated|info|why|bin|help|versions)\\b/': true,
	'/^yarn\\s+licenses\\b/': true,
	'/^yarn\\s+audit\\b(?!.*\\bfix\\b)/': true,
	'/^yarn\\s+config\\s+(list|get)\\b/': true,
	'/^yarn\\s+cache\\s+dir\\b/': true,
	'/^pnpm\\s+(ls|list|outdated|why|root|bin|doctor)\\b/': true,
	'/^pnpm\\s+licenses\\b/': true,
	'/^pnpm\\s+audit\\b(?!.*\\bfix\\b)/': true,
	'/^pnpm\\s+config\\s+(list|get)\\b/': true,

	'npm ci': true,
	'/^yarn\\s+install\\s+--frozen-lockfile\\b/': true,
	'/^pnpm\\s+install\\s+--frozen-lockfile\\b/': true,

	column: true,
	'/^column\\b.*\\s-c\\s+[0-9]{4,}/': false,
	date: true,
	'/^date\\b.*\\s(-s|--set)\\b/': false,
	find: true,
	'/^find\\b.*\\s-(delete|exec|execdir|fprint|fprintf|fls|ok|okdir)\\b/': false,
	rg: true,
	'/^rg\\b.*\\s(--pre|--hostname-bin)\\b/': false,
	sed: true,
	'/^sed\\b.*\\s(-[a-zA-Z]*(e|f)[a-zA-Z]*|--expression|--file)\\b/': false,
	'/^sed\\b.*s\\/.*\\/.*\\/[ew]/': false,
	'/^sed\\b(?:\\s+(?:(?:-l|--line-length)\\s+\\S+|--line-length=\\S+|-\\S+))*\\s+([\'"])\\s*(?:(?:\\d+|\\$|\\/(?:\\\\.|[^\\/])*\\/)(?:\\s*,\\s*(?:\\d+|\\$|\\/(?:\\\\.|[^\\/])*\\/))?)?\\s*!?\\s*[erRwW](?:\\s|\\1)/': false,
	'/^sed\\b(?:\\s+(?:(?:-l|--line-length)\\s+\\S+|--line-length=\\S+|-\\S+))*\\s+([\'"])(?:\\\\.|(?!\\1).)*[;{]\\s*(?:(?:\\d+|\\$|\\/(?:\\\\.|[^\\/])*\\/)(?:\\s*,\\s*(?:\\d+|\\$|\\/(?:\\\\.|[^\\/])*\\/))?)?\\s*!?\\s*[erRwW](?:\\s|\\1|[;}])/': false,
	'/^sed\\b(?:\\s+(?:(?:-l|--line-length)\\s+\\S+|--line-length=\\S+|-\\S+))*\\s+(?:(?:\\d+|\\$|\\/(?:\\\\.|[^\\/])*\\/)(?:\\s*,\\s*(?:\\d+|\\$|\\/(?:\\\\.|[^\\/])*\\/))?)?\\s*!?\\s*[erRwW](?:\\s|$)/': false,
	...sortAutoApproveRules,
	tree: true,
	'/^tree\\b.*\\s-o\\b/': false,
	'/^xxd$/': true,
	'/^xxd\\b(\\s+-\\S+)*\\s+[^-\\s]\\S*$/': true,

	rm: false,
	rmdir: false,
	del: false,
	'Remove-Item': false,
	ri: false,
	rd: false,
	erase: false,
	dd: false,
	kill: false,
	ps: false,
	top: false,
	'Stop-Process': false,
	spps: false,
	taskkill: false,
	'taskkill.exe': false,
	curl: false,
	wget: false,
	'Invoke-RestMethod': false,
	'Invoke-WebRequest': false,
	irm: false,
	iwr: false,
	chmod: false,
	chown: false,
	'Set-ItemProperty': false,
	sp: false,
	'Set-Acl': false,
	jq: false,
	xargs: false,
	eval: false,
	'Invoke-Expression': false,
	iex: false,
};
