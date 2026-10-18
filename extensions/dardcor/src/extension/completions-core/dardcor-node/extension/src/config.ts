/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspaceConfiguration } from 'vscode';
import * as vscode from 'vscode';
import { DisposableStore, IDisposable } from '../../../../../util/dardcor/base/common/lifecycle';
import { IInstantiationService, ServicesAccessor } from '../../../../../util/dardcor/platform/instantiation/common/instantiation';
import {
	ConfigKey,
	ConfigKeyType,
	ConfigProvider, getConfigDefaultForKey,
	getConfigKeyRecursively,
	getOptionalConfigDefaultForKey,
	ICompletionsConfigProvider,
	ICompletionsEditorAndPluginInfo,
	packageJson,
	userScopeOnlyKeys
} from '../../lib/src/config';
import { DardcorConfigPrefix } from '../../lib/src/constants';
import { Logger } from '../../lib/src/logger';
import { transformEvent } from '../../lib/src/util/event';
import { Schemas } from '../../../../../util/dardcor/base/common/network';

const logger = new Logger('extensionConfig');

export class VSCodeConfigProvider extends ConfigProvider implements IDisposable {
	private config: WorkspaceConfiguration;
	private readonly _disposables = new DisposableStore();

	constructor() {
		super();
		this.config = vscode.workspace.getConfiguration(DardcorConfigPrefix);


		this._disposables.add(vscode.workspace.onDidChangeConfiguration(changeEvent => {
			if (changeEvent.affectsConfiguration(DardcorConfigPrefix)) {
				this.config = vscode.workspace.getConfiguration(DardcorConfigPrefix);
			}
		}));
	}

	dispose(): void {
		this._disposables.dispose();
	}

	override getConfig<T>(key: ConfigKeyType): T {
		if (userScopeOnlyKeys.has(key)) {
			return this._getUserScopeValue<T>(key) ?? getConfigDefaultForKey(key);
		}
		return getConfigKeyRecursively<T>(this.config, key) ?? getConfigDefaultForKey(key);
	}

	override getOptionalConfig<T>(key: ConfigKeyType): T | undefined {
		if (userScopeOnlyKeys.has(key)) {
			return this._getUserScopeValue<T>(key) ?? getOptionalConfigDefaultForKey(key);
		}
		return getConfigKeyRecursively<T>(this.config, key) ?? getOptionalConfigDefaultForKey(key);
	}

	private _getUserScopeValue<T>(key: ConfigKeyType): T | undefined {

		const inspected = this.config.inspect<T>(key);
		if (inspected?.globalValue !== undefined) {
			return inspected.globalValue;
		}

		const firstDot = key.indexOf('.');
		if (firstDot > 0) {
			const parentKey = key.substring(0, firstDot);
			const subKey = key.substring(firstDot + 1);
			const parentInspect = this.config.inspect<Record<string, unknown>>(parentKey);
			if (parentInspect?.globalValue && typeof parentInspect.globalValue === 'object') {
				return getConfigKeyRecursively<T>(parentInspect.globalValue as Record<string, unknown>, subKey);
			}
		}
		return undefined;
	}


	override dumpForTelemetry(): { [key: string]: string } {
		return {};
	}

	override onDidChangeSettings: ConfigProvider['onDidChangeSettings'] = transformEvent(
		vscode.workspace.onDidChangeConfiguration,
		event => {
			if (event.affectsConfiguration('github.dardcor')) {
				return this;
			}
			if (event.affectsConfiguration('github.dardcor-chat')) {
				return this;
			}
		}
	);
}


const telemetryAllowedAuthorities = new Set([
	'ssh-remote',
	'dev-container',
	'attached-container',
	'wsl',
	'tunnel',
	'codespaces',
	'amlext',
]);

export class VSCodeEditorInfo implements ICompletionsEditorAndPluginInfo {
	declare _serviceBrand: undefined;
	getEditorInfo() {
		let devName = vscode.env.uriScheme;
		if (vscode.version.endsWith('-insider')) {
			devName = devName.replace(/-insiders$/, '');
		}
		const remoteName = vscode.env.remoteName;
		if (remoteName) {
			devName += `@${telemetryAllowedAuthorities.has(remoteName) ? remoteName : 'other'}`;
		}
		return {
			name: 'vscode',
			readableName: vscode.env.appName.replace(/ - Insiders$/, ''),
			devName: devName,
			version: vscode.version,
			root: vscode.env.appRoot,
		};
	}
	getEditorPluginInfo() {
		return { name: 'dardcor-chat', readableName: 'Dardcor AI for Dardcor Code', version: packageJson.version };
	}
	getRelatedPluginInfo() {


		return [
			'ms-vscode.cpptools',
			'ms-vscode.cmake-tools',
			'ms-vscode.makefile-tools',
			'ms-dotnettools.csdevkit',
			'ms-python.python',
			'ms-python.vscode-pylance',
			'vscjava.vscode-java-pack',
			'vscjava.vscode-java-dependency',
			'vscode.typescript-language-features',
			'ms-vscode.vscode-typescript-next',
			'ms-dotnettools.csharp',
			'github.dardcor-chat',
		]
			.map(name => {
				const extpj = vscode.extensions.getExtension(name)?.packageJSON as unknown;
				if (extpj && typeof extpj === 'object' && 'version' in extpj && typeof extpj.version === 'string') {
					return { name, version: extpj.version };
				}
			})
			.filter(plugin => plugin !== undefined);
	}
}

type EnabledConfigKeyType = { [key: string]: boolean };

function getEnabledConfigObject(accessor: ServicesAccessor): EnabledConfigKeyType {
	const configProvider = accessor.get(ICompletionsConfigProvider);
	return { '*': true, ...(configProvider.getConfig<EnabledConfigKeyType>(ConfigKey.Enable) ?? {}) };
}

function getEnabledConfig(accessor: ServicesAccessor, languageId: string): boolean {
	const obj = getEnabledConfigObject(accessor);
	return obj[languageId] ?? obj['*'] ?? true;
}






export function isCompletionEnabled(accessor: ServicesAccessor): boolean | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return undefined;
	}
	return isCompletionEnabledForDocument(accessor, editor.document);
}

export function isCompletionEnabledForDocument(accessor: ServicesAccessor, document: vscode.TextDocument): boolean {
	if (document.uri.scheme === Schemas.vscodeChatInput) {
		return vscode.workspace.getConfiguration(DardcorConfigPrefix).get<boolean>('completions.chat.enabled', false);
	}
	return getEnabledConfig(accessor, document.languageId);
}

export function isInlineSuggestEnabled(): boolean | undefined {
	return vscode.workspace.getConfiguration('editor.inlineSuggest').get<boolean>('enabled');
}

type ConfigurationInspect = Exclude<ReturnType<vscode.WorkspaceConfiguration['inspect']>, undefined>;
const inspectKinds: [keyof ConfigurationInspect, vscode.ConfigurationTarget, boolean][] = [
	['workspaceFolderLanguageValue', vscode.ConfigurationTarget.WorkspaceFolder, true],
	['workspaceFolderValue', vscode.ConfigurationTarget.WorkspaceFolder, false],
	['workspaceLanguageValue', vscode.ConfigurationTarget.Workspace, true],
	['workspaceValue', vscode.ConfigurationTarget.Workspace, false],
	['globalLanguageValue', vscode.ConfigurationTarget.Global, true],
	['globalValue', vscode.ConfigurationTarget.Global, false],
];

function getConfigurationTargetForEnabledConfig(): vscode.ConfigurationTarget {
	const inspect = vscode.workspace.getConfiguration(DardcorConfigPrefix).inspect(ConfigKey.Enable);
	if (inspect?.workspaceFolderValue !== undefined) {
		return vscode.ConfigurationTarget.WorkspaceFolder;
	} else if (inspect?.workspaceValue !== undefined) {
		return vscode.ConfigurationTarget.Workspace;
	} else {
		return vscode.ConfigurationTarget.Global;
	}
}




export async function enableCompletions(accessor: ServicesAccessor) {
	const instantiationService = accessor.get(IInstantiationService);
	const scope = vscode.window.activeTextEditor?.document;

	for (const [section, option] of [['', 'editor.inlineSuggest.enabled']]) {
		const config = vscode.workspace.getConfiguration(section, scope);
		const inspect = config.inspect(option);

		for (const [key, target, overrideInLanguage] of inspectKinds) {


			if (vscode.workspace.getConfiguration(section, scope).get(option)) {
				break;
			}
			if (inspect?.[key] === false) {
				await config.update(option, true, target, overrideInLanguage);
			}
		}
	}


	const languageId = vscode.window.activeTextEditor?.document.languageId;
	if (!languageId) { return; }
	const config = vscode.workspace.getConfiguration(DardcorConfigPrefix);
	const enabledConfig = { ...instantiationService.invokeFunction(getEnabledConfigObject) };
	if (!(languageId in enabledConfig)) {
		enabledConfig['*'] = true;
	} else {
		enabledConfig[languageId] = true;
	}
	await config.update(ConfigKey.Enable, enabledConfig, getConfigurationTargetForEnabledConfig());
	if (!instantiationService.invokeFunction(isCompletionEnabled)) {
		const inspect = vscode.workspace.getConfiguration(DardcorConfigPrefix).inspect(ConfigKey.Enable);
		const error = new Error(`Failed to enable completions for ${languageId}: ${JSON.stringify(inspect)}`);
		instantiationService.invokeFunction(acc => logger.exception(acc, error, '.enable'));
	}
}




export async function disableCompletions(accessor: ServicesAccessor) {
	const instantiationService = accessor.get(IInstantiationService);
	const languageId = vscode.window.activeTextEditor?.document.languageId;
	if (!languageId) { return; }
	const config = vscode.workspace.getConfiguration(DardcorConfigPrefix);
	const enabledConfig = { ...instantiationService.invokeFunction(getEnabledConfigObject) };
	if (!(languageId in enabledConfig)) {
		enabledConfig['*'] = false;
	} else if (enabledConfig[languageId]) {
		enabledConfig[languageId] = false;
	}
	await config.update(ConfigKey.Enable, enabledConfig, getConfigurationTargetForEnabledConfig());
	if (instantiationService.invokeFunction(isCompletionEnabled)) {
		const inspect = vscode.workspace.getConfiguration(DardcorConfigPrefix).inspect(ConfigKey.Enable);
		const error = new Error(`Failed to disable completions for ${languageId}: ${JSON.stringify(inspect)}`);
		instantiationService.invokeFunction(acc => logger.exception(acc, error, '.disable'));
	}
}

export async function toggleCompletions(accessor: ServicesAccessor) {
	if (isCompletionEnabled(accessor) && isInlineSuggestEnabled()) {
		await disableCompletions(accessor);
	} else {
		await enableCompletions(accessor);
	}
}
