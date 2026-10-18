/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { structuralEquals } from '../../../../../../../../base/common/equals.js';
import { Disposable } from '../../../../../../../../base/common/lifecycle.js';
import type { OperatingSystem } from '../../../../../../../../base/common/platform.js';
import { escapeRegExpCharacters, regExpLeadsToEndlessLoop } from '../../../../../../../../base/common/strings.js';
import { isObject } from '../../../../../../../../base/common/types.js';
import type { URI } from '../../../../../../../../base/common/uri.js';
import { ConfigurationTarget, IConfigurationService, type IConfigurationValue } from '../../../../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../../../../../platform/instantiation/common/instantiation.js';
import { ITerminalChatService } from '../../../../../../terminal/browser/terminal.js';
import { TerminalChatAgentToolsSettingId } from '../../../../common/terminalChatAgentToolsConfiguration.js';
import { isPowerShell } from '../../../runInTerminalHelpers.js';
import type { IAutoApproveRule, INpmScriptAutoApproveRule } from '../commandLineAnalyzer.js';
import { NpmScriptAutoApprover } from './npmScriptAutoApprover.js';

export interface ICommandApprovalResultWithReason {
	result: ICommandApprovalResult;
	reason: string;
	rule?: IAutoApproveRule | INpmScriptAutoApproveRule;
}

export type ICommandApprovalResult = 'approved' | 'denied' | 'noMatch';

const neverMatchRegex = /(?!.*)/;
const transientEnvVarRegex = /^[A-Z_][A-Z0-9_]*=/i;

export class CommandLineAutoApprover extends Disposable {
	private _denyListRules: IAutoApproveRule[] = [];
	private _allowListRules: IAutoApproveRule[] = [];
	private _allowListCommandLineRules: IAutoApproveRule[] = [];
	private _denyListCommandLineRules: IAutoApproveRule[] = [];
	private readonly _npmScriptAutoApprover: NpmScriptAutoApprover;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ITerminalChatService private readonly _terminalChatService: ITerminalChatService,
	) {
		super();
		this._npmScriptAutoApprover = this._register(instantiationService.createInstance(NpmScriptAutoApprover));
		this.updateConfiguration();
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(TerminalChatAgentToolsSettingId.AutoApprove) ||
				e.affectsConfiguration(TerminalChatAgentToolsSettingId.IgnoreDefaultAutoApproveRules) ||
				e.affectsConfiguration(TerminalChatAgentToolsSettingId.DeprecatedAutoApproveCompatible)
			) {
				this.updateConfiguration();
			}
		}));
	}

	updateConfiguration() {
		let configValue = this._configurationService.getValue(TerminalChatAgentToolsSettingId.AutoApprove);
		const configInspectValue = this._configurationService.inspect(TerminalChatAgentToolsSettingId.AutoApprove);
		const deprecatedValue = this._configurationService.getValue(TerminalChatAgentToolsSettingId.DeprecatedAutoApproveCompatible);
		if (deprecatedValue && typeof deprecatedValue === 'object' && configValue && typeof configValue === 'object') {
			configValue = {
				...configValue,
				...deprecatedValue
			};
		}

		const {
			denyListRules,
			allowListRules,
			allowListCommandLineRules,
			denyListCommandLineRules
		} = this._mapAutoApproveConfigToRules(configValue, configInspectValue);
		this._allowListRules = allowListRules;
		this._denyListRules = denyListRules;
		this._allowListCommandLineRules = allowListCommandLineRules;
		this._denyListCommandLineRules = denyListCommandLineRules;
	}

	async isCommandAutoApproved(command: string, shell: string, os: OperatingSystem, cwd: URI | undefined, chatSessionResource?: URI): Promise<ICommandApprovalResultWithReason> {
		if (transientEnvVarRegex.test(command)) {
			return {
				result: 'denied',
				reason: `Command '${command}' is denied because it contains transient environment variables`
			};
		}

		for (const rule of this._denyListRules) {
			if (this._commandMatchesRule(rule, command, shell, os)) {
				return {
					result: 'denied',
					rule,
					reason: `Command '${command}' is denied by deny list rule: ${rule.sourceText}`
				};
			}
		}

		for (const rule of this._getSessionRules(chatSessionResource).allowListRules) {
			if (this._commandMatchesRule(rule, command, shell, os)) {
				return {
					result: 'approved',
					rule,
					reason: `Command '${command}' is approved by session allow list rule: ${rule.sourceText}`
				};
			}
		}

		for (const rule of this._allowListRules) {
			if (this._commandMatchesRule(rule, command, shell, os)) {
				return {
					result: 'approved',
					rule,
					reason: `Command '${command}' is approved by allow list rule: ${rule.sourceText}`
				};
			}
		}

		const npmScriptResult = await this._npmScriptAutoApprover.isCommandAutoApproved(command, cwd);
		if (npmScriptResult.isAutoApproved) {
			return {
				result: 'approved',
				rule: { type: 'npmScript', npmScriptResult },
				reason: `Command '${command}' is approved as npm script '${npmScriptResult.scriptName}' is defined in package.json`
			};
		}


		return {
			result: 'noMatch',
			reason: `Command '${command}' has no matching auto approve entries`
		};
	}

	isCommandLineAutoApproved(commandLine: string, chatSessionResource?: URI): ICommandApprovalResultWithReason {
		for (const rule of this._denyListCommandLineRules) {
			if (rule.regex.test(commandLine)) {
				return {
					result: 'denied',
					rule,
					reason: `Command line '${commandLine}' is denied by deny list rule: ${rule.sourceText}`
				};
			}
		}

		for (const rule of this._getSessionRules(chatSessionResource).allowListCommandLineRules) {
			if (rule.regex.test(commandLine)) {
				return {
					result: 'approved',
					rule,
					reason: `Command line '${commandLine}' is approved by session allow list rule: ${rule.sourceText}`
				};
			}
		}

		for (const rule of this._allowListCommandLineRules) {
			if (rule.regex.test(commandLine)) {
				return {
					result: 'approved',
					rule,
					reason: `Command line '${commandLine}' is approved by allow list rule: ${rule.sourceText}`
				};
			}
		}
		return {
			result: 'noMatch',
			reason: `Command line '${commandLine}' has no matching auto approve entries`
		};
	}

	private _getSessionRules(chatSessionResource?: URI): {
		denyListRules: IAutoApproveRule[];
		allowListRules: IAutoApproveRule[];
		allowListCommandLineRules: IAutoApproveRule[];
		denyListCommandLineRules: IAutoApproveRule[];
	} {
		const denyListRules: IAutoApproveRule[] = [];
		const allowListRules: IAutoApproveRule[] = [];
		const allowListCommandLineRules: IAutoApproveRule[] = [];
		const denyListCommandLineRules: IAutoApproveRule[] = [];

		if (!chatSessionResource) {
			return { denyListRules, allowListRules, allowListCommandLineRules, denyListCommandLineRules };
		}

		const sessionRulesConfig = this._terminalChatService.getSessionAutoApproveRules(chatSessionResource);
		for (const [key, value] of Object.entries(sessionRulesConfig)) {
			if (typeof value === 'boolean') {
				const { regex, regexCaseInsensitive } = this._convertAutoApproveEntryToRegex(key);
				if (value === true) {
					allowListRules.push({ regex, regexCaseInsensitive, sourceText: key, sourceTarget: 'session', isDefaultRule: false });
				} else if (value === false) {
					denyListRules.push({ regex, regexCaseInsensitive, sourceText: key, sourceTarget: 'session', isDefaultRule: false });
				}
			} else if (typeof value === 'object' && value !== null) {
				const objectValue = value as { approve?: boolean; matchCommandLine?: boolean };
				if (typeof objectValue.approve === 'boolean') {
					const { regex, regexCaseInsensitive } = this._convertAutoApproveEntryToRegex(key);
					if (objectValue.approve === true) {
						if (objectValue.matchCommandLine === true) {
							allowListCommandLineRules.push({ regex, regexCaseInsensitive, sourceText: key, sourceTarget: 'session', isDefaultRule: false });
						} else {
							allowListRules.push({ regex, regexCaseInsensitive, sourceText: key, sourceTarget: 'session', isDefaultRule: false });
						}
					} else if (objectValue.approve === false) {
						if (objectValue.matchCommandLine === true) {
							denyListCommandLineRules.push({ regex, regexCaseInsensitive, sourceText: key, sourceTarget: 'session', isDefaultRule: false });
						} else {
							denyListRules.push({ regex, regexCaseInsensitive, sourceText: key, sourceTarget: 'session', isDefaultRule: false });
						}
					}
				}
			}
		}

		return { denyListRules, allowListRules, allowListCommandLineRules, denyListCommandLineRules };
	}

	private _commandMatchesRule(rule: IAutoApproveRule, command: string, shell: string, os: OperatingSystem): boolean {
		const isPwsh = isPowerShell(shell, os);

		if ((isPwsh ? rule.regexCaseInsensitive : rule.regex).test(command)) {
			return true;
		} else if (isPwsh && command.startsWith('(')) {
			if (rule.regexCaseInsensitive.test(command.slice(1))) {
				return true;
			}
		}
		return false;
	}

	private _mapAutoApproveConfigToRules(config: unknown, configInspectValue: IConfigurationValue<Readonly<unknown>>): {
		denyListRules: IAutoApproveRule[];
		allowListRules: IAutoApproveRule[];
		allowListCommandLineRules: IAutoApproveRule[];
		denyListCommandLineRules: IAutoApproveRule[];
	} {
		if (!config || typeof config !== 'object') {
			return {
				denyListRules: [],
				allowListRules: [],
				allowListCommandLineRules: [],
				denyListCommandLineRules: []
			};
		}

		const denyListRules: IAutoApproveRule[] = [];
		const allowListRules: IAutoApproveRule[] = [];
		const allowListCommandLineRules: IAutoApproveRule[] = [];
		const denyListCommandLineRules: IAutoApproveRule[] = [];

		const ignoreDefaults = this._configurationService.getValue(TerminalChatAgentToolsSettingId.IgnoreDefaultAutoApproveRules) === true;

		for (const [key, value] of Object.entries(config)) {
			const defaultValue = configInspectValue?.default?.value;
			const isDefaultRule = !!(
				isObject(defaultValue) &&
				Object.prototype.hasOwnProperty.call(defaultValue, key) &&
				structuralEquals((defaultValue as Record<string, unknown>)[key], value)
			);
			function checkTarget(inspectValue: Readonly<unknown> | undefined): boolean {
				return (
					isObject(inspectValue) &&
					Object.prototype.hasOwnProperty.call(inspectValue, key) &&
					structuralEquals((inspectValue as Record<string, unknown>)[key], value)
				);
			}
			const sourceTarget = (
				checkTarget(configInspectValue.workspaceFolderValue) ? ConfigurationTarget.WORKSPACE_FOLDER
					: checkTarget(configInspectValue.workspaceValue) ? ConfigurationTarget.WORKSPACE
						: checkTarget(configInspectValue.userRemoteValue) ? ConfigurationTarget.USER_REMOTE
							: checkTarget(configInspectValue.userLocalValue) ? ConfigurationTarget.USER_LOCAL
								: checkTarget(configInspectValue.userValue) ? ConfigurationTarget.USER
									: checkTarget(configInspectValue.applicationValue) ? ConfigurationTarget.APPLICATION
										: ConfigurationTarget.DEFAULT
			);

			if (ignoreDefaults && isDefaultRule && sourceTarget === ConfigurationTarget.DEFAULT) {
				continue;
			}

			if (typeof value === 'boolean') {
				const { regex, regexCaseInsensitive } = this._convertAutoApproveEntryToRegex(key);
				if (value === true) {
					allowListRules.push({ regex, regexCaseInsensitive, sourceText: key, sourceTarget, isDefaultRule });
				} else if (value === false) {
					denyListRules.push({ regex, regexCaseInsensitive, sourceText: key, sourceTarget, isDefaultRule });
				}
			} else if (typeof value === 'object' && value !== null) {
				const objectValue = value as { approve?: boolean; matchCommandLine?: boolean };
				if (typeof objectValue.approve === 'boolean') {
					const { regex, regexCaseInsensitive } = this._convertAutoApproveEntryToRegex(key);
					if (objectValue.approve === true) {
						if (objectValue.matchCommandLine === true) {
							allowListCommandLineRules.push({ regex, regexCaseInsensitive, sourceText: key, sourceTarget, isDefaultRule });
						} else {
							allowListRules.push({ regex, regexCaseInsensitive, sourceText: key, sourceTarget, isDefaultRule });
						}
					} else if (objectValue.approve === false) {
						if (objectValue.matchCommandLine === true) {
							denyListCommandLineRules.push({ regex, regexCaseInsensitive, sourceText: key, sourceTarget, isDefaultRule });
						} else {
							denyListRules.push({ regex, regexCaseInsensitive, sourceText: key, sourceTarget, isDefaultRule });
						}
					}
				}
			}
		}

		return {
			denyListRules,
			allowListRules,
			allowListCommandLineRules,
			denyListCommandLineRules
		};
	}

	private _convertAutoApproveEntryToRegex(value: string): { regex: RegExp; regexCaseInsensitive: RegExp } {
		const regex = this._doConvertAutoApproveEntryToRegex(value);
		if (regex.flags.includes('i')) {
			return { regex, regexCaseInsensitive: regex };
		}
		return { regex, regexCaseInsensitive: new RegExp(regex.source, regex.flags + 'i') };
	}

	private _doConvertAutoApproveEntryToRegex(value: string): RegExp {
		const regexMatch = value.match(/^\/(?<pattern>.+)\/(?<flags>[dgimsuvy]*)$/);
		const regexPattern = regexMatch?.groups?.pattern;
		if (regexPattern) {
			let flags = regexMatch.groups?.flags;
			// Remove global flag as it changes how the regex state works which we need to handle
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
			} catch (error) {
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
		}

		else {
			sanitizedValue = escapeRegExpCharacters(value);
		}

		return new RegExp(`^${sanitizedValue}\\b`);
	}
}
