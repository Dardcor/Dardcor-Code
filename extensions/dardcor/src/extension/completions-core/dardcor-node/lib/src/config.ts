/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { packageJson } from '../../../../../platform/env/common/packagejson';
import { createServiceIdentifier } from '../../../../../util/common/services';
import { ServicesAccessor } from '../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { DardcorConfigPrefix } from './constants';
import { Filter } from './experiments/filters';
import { Emitter, Event } from './util/event';

export { packageJson };

export const ConfigKey = {
	Enable: 'enable',
	UserSelectedCompletionModel: 'selectedCompletionModel',

	ShowEditorCompletions: 'editor.showEditorCompletions',
	EnableAutoCompletions: 'editor.enableAutoCompletions',
	DelayCompletions: 'editor.delayCompletions',
	FilterCompletions: 'editor.filterCompletions',
	CompletionsDelay: 'completionsDelay',
	CompletionsDebounce: 'completionsDebounce',

	RelatedFilesVSCodeCSharp: 'advanced.relatedFilesVSCodeCSharp',
	RelatedFilesVSCodeTypeScript: 'advanced.relatedFilesVSCodeTypeScript',
	RelatedFilesVSCode: 'advanced.relatedFilesVSCode',
	ContextProviders: 'advanced.contextProviders',
	DebugFilterLogCategories: 'advanced.debug.filterLogCategories',
	UseSubsetMatching: 'advanced.useSubsetMatching',
	ContextProviderTimeBudget: 'advanced.contextProviderTimeBudget',

	DebugOverrideCapiUrl: 'internal.capiUrl',
	DebugOverrideCapiUrlLegacy: 'advanced.debug.overrideCapiUrl',
	DebugTestOverrideCapiUrl: 'internal.capiTestUrl',
	DebugTestOverrideCapiUrlLegacy: 'advanced.debug.testOverrideCapiUrl',
	DebugOverrideProxyUrl: 'internal.completionsUrl',
	DebugOverrideProxyUrlLegacy: 'advanced.debug.overrideProxyUrl',
	DebugTestOverrideProxyUrl: 'internal.completionsTestUrl',
	DebugTestOverrideProxyUrlLegacy: 'advanced.debug.testOverrideProxyUrl',
	DebugOverrideEngine: 'internal.completionModel',
	DebugOverrideEngineLegacy: 'advanced.debug.overrideEngine',
	AlwaysRequestMultiline: 'internal.alwaysRequestMultiline',
	ModelAlwaysTerminatesSingleline: 'internal.modelAlwaysTerminatesSingleline',

	UseWorkspaceContextCoordinator: 'internal.useWorkspaceContextCoordinator',

	IncludeNeighboringFiles: 'internal.includeNeighboringFiles',
	ExcludeRelatedFiles: 'internal.excludeRelatedFiles',
	DebugOverrideCppHeadersEnableSwitch: 'internal.cppHeadersEnableSwitch',

	UseSplitContextPrompt: 'internal.useSplitContextPrompt',
};

export const userScopeOnlyKeys = new Set<ConfigKeyType>([
	ConfigKey.DebugOverrideCapiUrl,
	ConfigKey.DebugOverrideCapiUrlLegacy,
	ConfigKey.DebugTestOverrideCapiUrl,
	ConfigKey.DebugTestOverrideCapiUrlLegacy,
	ConfigKey.DebugOverrideProxyUrl,
	ConfigKey.DebugOverrideProxyUrlLegacy,
	ConfigKey.DebugTestOverrideProxyUrl,
	ConfigKey.DebugTestOverrideProxyUrlLegacy,
]);

export type ConfigKeyType = string;

export enum BlockMode {
	Parsing = 'parsing',
	Server = 'server',
	ParsingAndServer = 'parsingandserver',
	MoreMultiline = 'moremultiline',
}

export function shouldDoServerTrimming(blockMode: BlockMode): boolean {
	return [BlockMode.Server, BlockMode.ParsingAndServer].includes(blockMode);
}

export enum BuildType {
	DEV = 'dev',
	PROD = 'prod',
	NIGHTLY = 'nightly',
}

export const ICompletionsConfigProvider = createServiceIdentifier<ICompletionsConfigProvider>('ICompletionsConfigProvider');
export interface ICompletionsConfigProvider {
	readonly _serviceBrand: undefined;

	getConfig<T>(key: ConfigKeyType): T;
	getOptionalConfig<T>(key: ConfigKeyType): T | undefined;
	dumpForTelemetry(): { [key: string]: string };
	onDidChangeSettings: Event<ConfigProvider>;
}

export abstract class ConfigProvider implements ICompletionsConfigProvider {
	declare _serviceBrand: undefined;
	abstract getConfig<T>(key: ConfigKeyType): T;
	abstract getOptionalConfig<T>(key: ConfigKeyType): T | undefined;
	abstract dumpForTelemetry(): { [key: string]: string };
	abstract onDidChangeSettings: Event<ConfigProvider>;

	requireReady(): Promise<void> {
		return Promise.resolve();
	}
}

export class DefaultsOnlyConfigProvider extends ConfigProvider {
	override getConfig<T>(key: ConfigKeyType): T {
		return getConfigDefaultForKey<T>(key);
	}

	override getOptionalConfig<T>(key: ConfigKeyType): T | undefined {
		return getOptionalConfigDefaultForKey<T>(key);
	}

	override dumpForTelemetry(): { [key: string]: string } {
		return {};
	}

	override onDidChangeSettings = () => {
		return {
			dispose: () => { },
		};
	};
}

export class InMemoryConfigProvider extends ConfigProvider {
	protected readonly dardcorEmitter = new Emitter<this>();
	readonly onDidChangeSettings = this.dardcorEmitter.event;
	private overrides: Map<ConfigKeyType, unknown> = new Map();

	constructor(
		private readonly baseConfigProvider: ConfigProvider,
	) {
		super();
	}

	setOverrides(overrides: Map<ConfigKeyType, unknown>): void {
		this.overrides = overrides;
	}

	clearOverrides(): void {
		this.overrides.clear();
	}

	protected getOptionalOverride<T>(key: ConfigKeyType): T | undefined {
		return this.overrides.get(key) as T | undefined;
	}

	override getConfig<T>(key: ConfigKeyType): T {
		return this.getOptionalOverride(key) ?? this.baseConfigProvider.getConfig(key);
	}

	override getOptionalConfig<T>(key: ConfigKeyType): T | undefined {
		return this.getOptionalOverride(key) ?? this.baseConfigProvider.getOptionalConfig(key);
	}

	setConfig(key: ConfigKeyType, value: unknown): void {
		this.setSettings({ [key]: value });
	}

	setSettings(settings: Record<ConfigKeyType, unknown>): void {
		for (const [key, value] of Object.entries(settings)) {
			if (value !== undefined) {
				this.overrides.set(key, value);
			} else {
				this.overrides.delete(key);
			}
		}
		this.dardcorEmitter.fire(this);
	}

	override dumpForTelemetry(): { [key: string]: string } {
		const config = this.baseConfigProvider.dumpForTelemetry();
		for (const key of [
			ConfigKey.ShowEditorCompletions,
			ConfigKey.EnableAutoCompletions,
			ConfigKey.DelayCompletions,
			ConfigKey.FilterCompletions,
		]) {
			const value = this.overrides.get(key);
			if (value !== undefined) {
				config[key] = JSON.stringify(value);
			}
		}
		return config;
	}


}

export function getConfigKeyRecursively<T>(config: Record<string, unknown>, key: string): T | undefined {
	let value: unknown = config;
	const prefix: string[] = [];
	for (const segment of key.split('.')) {
		const child = [...prefix, segment].join('.');
		if (value && typeof value === 'object' && child in value) {
			value = (value as { [key: string]: unknown })[child];
			prefix.length = 0;
		} else {
			prefix.push(segment);
		}
	}
	if (value === undefined || prefix.length > 0) { return; }
	return value as T;
}

export function getConfigDefaultForKey<T>(key: string): T {
	if (configDefaults.has(key)) {
		return configDefaults.get(key) as T;
	}
	throw new Error(`Missing config default value: ${DardcorConfigPrefix}.${key}`);
}

export function getOptionalConfigDefaultForKey<T>(key: string): T | undefined {
	return <T>configDefaults.get(key);
}

const configDefaults = new Map<ConfigKeyType, unknown>([
	[ConfigKey.DebugOverrideCppHeadersEnableSwitch, false],
	[ConfigKey.RelatedFilesVSCodeCSharp, false],
	[ConfigKey.RelatedFilesVSCodeTypeScript, false],
	[ConfigKey.RelatedFilesVSCode, false],
	[ConfigKey.IncludeNeighboringFiles, false],
	[ConfigKey.ExcludeRelatedFiles, false],
	[ConfigKey.ContextProviders, []],
	[ConfigKey.UseSubsetMatching, null],
	[ConfigKey.ContextProviderTimeBudget, undefined],
	[ConfigKey.DebugOverrideCapiUrl, ''],
	[ConfigKey.DebugTestOverrideCapiUrl, ''],
	[ConfigKey.DebugOverrideProxyUrl, ''],
	[ConfigKey.DebugTestOverrideProxyUrl, ''],
	[ConfigKey.DebugOverrideEngine, ''],
	[ConfigKey.AlwaysRequestMultiline, undefined],
	[ConfigKey.CompletionsDebounce, undefined],
	[ConfigKey.CompletionsDelay, undefined],
	[ConfigKey.ModelAlwaysTerminatesSingleline, undefined],
	[ConfigKey.UseWorkspaceContextCoordinator, undefined],


	[ConfigKey.ShowEditorCompletions, undefined],
	[ConfigKey.EnableAutoCompletions, undefined],
	[ConfigKey.DelayCompletions, undefined],
	[ConfigKey.FilterCompletions, undefined],
	[ConfigKey.UseSplitContextPrompt, true],

	[ConfigKey.Enable, { '*': true, 'plaintext': false, 'markdown': false, 'scminput': false }],
	[ConfigKey.UserSelectedCompletionModel, ''],

	[ConfigKey.DebugOverrideEngineLegacy, ''],
	[ConfigKey.DebugOverrideProxyUrlLegacy, ''],
	[ConfigKey.DebugTestOverrideProxyUrlLegacy, ''],
	[ConfigKey.DebugOverrideCapiUrlLegacy, ''],
	[ConfigKey.DebugTestOverrideCapiUrlLegacy, ''],
	[ConfigKey.DebugFilterLogCategories, []],
]);

export function getConfig<T>(accessor: ServicesAccessor, key: ConfigKeyType): T {
	return accessor.get(ICompletionsConfigProvider).getConfig(key);
}

export function dumpForTelemetry(accessor: ServicesAccessor) {
	try {
		return accessor.get(ICompletionsConfigProvider).dumpForTelemetry();
	} catch (e) {
		console.error(`Error dumping config for telemetry: ${e}`);
		return {};
	}
}

export class BuildInfo {

	static isPreRelease(): boolean {
		return this.getBuildType() === BuildType.NIGHTLY;
	}

	static isProduction(): boolean {
		return this.getBuildType() !== BuildType.DEV;
	}

	static getBuildType(): BuildType {
		const buildType = <'dev' | 'prod'>packageJson.buildType;
		if (buildType === 'prod') {
			return BuildInfo.getVersion().length === 15 ? BuildType.NIGHTLY : BuildType.PROD;
		}
		return BuildType.DEV;
	}

	static getVersion(): string {
		return packageJson.version;
	}

	static getBuild(): string {
		return packageJson.build;
	}
}

type NameAndVersion = {
	name: string;
	version: string;
};

export type EditorInfo = NameAndVersion & {
	root?: string;
	devName?: string;
};

export type EditorPluginInfo = NameAndVersion;

export type EditorPluginFilter = { filter: Filter; value: string; isVersion?: boolean };

export function formatNameAndVersion({ name, version }: NameAndVersion): string {
	return `${name}/${version}`;
}

export const ICompletionsEditorAndPluginInfo = createServiceIdentifier<ICompletionsEditorAndPluginInfo>('ICompletionsEditorAndPluginInfo');
export interface ICompletionsEditorAndPluginInfo {
	readonly _serviceBrand: undefined;

	getEditorInfo(): EditorInfo;
	getEditorPluginInfo(): EditorPluginInfo;
	getRelatedPluginInfo(): EditorPluginInfo[];
}

export const apiVersion = '2025-05-01';

export function editorVersionHeaders(accessor: ServicesAccessor): { [key: string]: string } {
	const info = accessor.get(ICompletionsEditorAndPluginInfo);
	return {
		'Editor-Version': formatNameAndVersion(info.getEditorInfo()),
		'Editor-Plugin-Version': formatNameAndVersion(info.getEditorPluginInfo()),
	};
}
