/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../../../platform/log/common/logService';
import { IExperimentationService } from '../../../../../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import {
	DEFAULT_MAX_COMPLETION_LENGTH,
	DEFAULT_MAX_PROMPT_LENGTH,
	DEFAULT_PROMPT_ALLOCATION_PERCENT,
	DEFAULT_SUFFIX_MATCH_THRESHOLD
} from '../../../prompt/src/prompt';
import { BlockMode } from '../config';
import { TelemetryData, TelemetryWithExp } from '../telemetry';
import { createCompletionsFilters } from './defaultExpFilters';
import { ExpConfig, ExpTreatmentVariables, ExpTreatmentVariableValue } from './expConfig';
import { CompletionsFiltersInfo, ContextProviderExpSettings, ICompletionsFeaturesService } from './featuresService';
import { Filter, FilterSettings } from './filters';

type InternalContextProviderExpSettings = {
	id?: string;
	ids?: string[];
	includeNeighboringFiles?: boolean;
	excludeRelatedFiles?: boolean;
	timeBudget?: number;
	params?: Record<string, string | boolean | number>;
};

export class Features implements ICompletionsFeaturesService {
	declare _serviceBrand: undefined;

	private readonly includeNeighboringFilesDefault: Map<string, boolean>;
	private readonly excludeRelatedFilesDefault: Map<string, boolean>;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IExperimentationService private readonly experimentationService: IExperimentationService,
	) {
		this.includeNeighboringFilesDefault = new Map<string, boolean>();
		this.excludeRelatedFilesDefault = new Map<string, boolean>();
	}

	async updateExPValuesAndAssignments(
		filtersInfo?: CompletionsFiltersInfo,
		telemetryData: TelemetryData = TelemetryData.createAndMarkAsIssued()
	): Promise<TelemetryWithExp> {
		if (telemetryData instanceof TelemetryWithExp) {
			throw new Error('updateExPValuesAndAssignments should not be called with TelemetryWithExp');
		}

		const { filters, exp } = this.createExpConfigAndFilters();

		return new TelemetryWithExp(telemetryData.properties, telemetryData.measurements, telemetryData.issuedTime, {
			filters,
			exp: exp,
		});
	}

	async fetchAndUpdateExPValuesAndAssignments(
		filtersInfo?: CompletionsFiltersInfo,
		telemetryData?: TelemetryData
	) {
		return await this.updateExPValuesAndAssignments(filtersInfo, telemetryData);
	}

	private createExpConfigAndFilters() {

		const exp2: Partial<Record<ExpTreatmentVariables, ExpTreatmentVariableValue>> = {};
		for (const varName of Object.values<ExpTreatmentVariables>(ExpTreatmentVariables)) {
			const value = this.experimentationService.getTreatmentVariable(varName);
			if (value !== undefined) {
				exp2[varName] = value;
			}
		}

		const features = Object.entries(exp2).map(([name, value]) => {
			return name + (value ? '' : 'cf');
		});
		const exp = new ExpConfig(exp2, features.join(';'));
		const filterMap = this.instantiationService.invokeFunction(createCompletionsFilters);
		const filterRecord: Partial<Record<Filter, string>> = {};
		for (const [key, value] of filterMap.entries()) {
			filterRecord[key] = value;
		}

		const filters = new FilterSettings(filterRecord);
		return { filters, exp };
	}

	async getFallbackExpAndFilters(): Promise<{ filters: FilterSettings; exp: ExpConfig }> {
		return this.createExpConfigAndFilters();
	}

	overrideBlockMode(telemetryWithExp: TelemetryWithExp): BlockMode | undefined {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.OverrideBlockMode] as BlockMode) ||
			undefined
		);
	}


	customEngine(telemetryWithExp: TelemetryWithExp): string {
		return (telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.CustomEngine] as string) ?? '';
	}

	customEngineTargetEngine(telemetryWithExp: TelemetryWithExp): string | undefined {
		return telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.CustomEngineTargetEngine] as string;
	}

	suffixPercent(telemetryWithExp: TelemetryWithExp): number {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.SuffixPercent] as number) ??
			DEFAULT_PROMPT_ALLOCATION_PERCENT.suffix
		);
	}

	suffixMatchThreshold(telemetryWithExp: TelemetryWithExp): number {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.SuffixMatchThreshold] as number) ??
			DEFAULT_SUFFIX_MATCH_THRESHOLD
		);
	}

	cppHeadersEnableSwitch(telemetryWithExp: TelemetryWithExp): boolean {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.CppHeadersEnableSwitch] as boolean) ??
			false
		);
	}

	relatedFilesVSCodeCSharp(telemetryWithExp: TelemetryWithExp): boolean {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.RelatedFilesVSCodeCSharp] as boolean) ??
			false
		);
	}

	relatedFilesVSCodeTypeScript(telemetryWithExp: TelemetryWithExp): boolean {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[
				ExpTreatmentVariables.RelatedFilesVSCodeTypeScript
			] as boolean) ?? false
		);
	}

	relatedFilesVSCode(telemetryWithExp: TelemetryWithExp): boolean {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.RelatedFilesVSCode] as boolean) ?? false
		);
	}

	contextProviders(telemetryWithExp: TelemetryWithExp): string[] {
		const providers = (telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.ContextProviders] ??
			'') as string;
		if (!providers) {
			return [];
		}
		return providers.split(',').map(provider => provider.trim());
	}

	contextProviderTimeBudget(languageId: string, telemetryWithExp: TelemetryWithExp): number {
		const client = (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.ContextProviderTimeBudget] as number) ??
			150
		);
		if (client) {
			return client;
		}
		const chat = this.getContextProviderExpSettings(languageId);
		return chat?.timeBudget ?? 150;
	}

	setIncludeNeighboringFilesDefault(languageId: string, include: boolean): void {
		this.includeNeighboringFilesDefault.set(languageId, include);
	}

	includeNeighboringFiles(languageId: string, telemetryWithExp: TelemetryWithExp): boolean {
		const client = (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.IncludeNeighboringFiles] as boolean) ??
			false
		);
		if (client) {
			return true;
		}
		const chat = this.getContextProviderExpSettings(languageId);
		return chat?.includeNeighboringFiles ?? this.includeNeighboringFilesDefault.get(languageId) ?? false;
	}

	setExcludeRelatedFilesDefault(languageId: string, exclude: boolean): void {
		this.excludeRelatedFilesDefault.set(languageId, exclude);
	}

	excludeRelatedFiles(languageId: string, telemetryWithExp: TelemetryWithExp): boolean {
		const client = (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.ExcludeRelatedFiles] as boolean) ??
			false
		);
		if (client) {
			return true;
		}
		const chat = this.getContextProviderExpSettings(languageId);
		return chat?.excludeRelatedFiles ?? this.excludeRelatedFilesDefault.get(languageId) ?? false;
	}

	getContextProviderExpSettings(languageId: string): ContextProviderExpSettings | undefined {
		const value = this.experimentationService.getTreatmentVariable<string>(`config.github.dardcor.chat.contextprovider.${languageId}`);
		if (typeof value === 'string') {
			try {
				const parsed: Partial<InternalContextProviderExpSettings> = JSON.parse(value);
				const ids = this.getProviderIDs(parsed);
				delete parsed.id;
				delete parsed.ids;
				return Object.assign({ ids }, { includeNeighboringFiles: false, excludeRelatedFiles: false, timeBudget: 150 }, parsed as Omit<InternalContextProviderExpSettings, 'id' | 'ids'>);
			} catch (err) {
				this.instantiationService.invokeFunction((accessor) => {
					const logService = accessor.get(ILogService);
					logService.error(`Failed to parse context provider exp settings for language ${languageId}`);
				});
				return undefined;
			}
		} else {
			return undefined;
		}
	}

	private getProviderIDs(json: InternalContextProviderExpSettings): string[] {
		const result: string[] = [];
		if (typeof json.id === 'string' && json.id.length > 0) {
			result.push(json.id);
		}
		if (Array.isArray(json.ids)) {
			for (const id of json.ids) {
				if (typeof id === 'string' && id.length > 0) {
					result.push(id);
				}
			}
		}
		return result;
	}

	maxPromptCompletionTokens(telemetryWithExp: TelemetryWithExp): number {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.MaxPromptCompletionTokens] as number) ??
			DEFAULT_MAX_PROMPT_LENGTH + DEFAULT_MAX_COMPLETION_LENGTH
		);
	}

	stableContextPercent(telemetryWithExp: TelemetryWithExp): number {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.StableContextPercent] as number) ??
			DEFAULT_PROMPT_ALLOCATION_PERCENT.stableContext
		);
	}

	volatileContextPercent(telemetryWithExp: TelemetryWithExp): number {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.VolatileContextPercent] as number) ??
			DEFAULT_PROMPT_ALLOCATION_PERCENT.volatileContext
		);
	}

	cppContextProviderParams(telemetryWithExp: TelemetryWithExp): string | undefined {
		const cppContextProviderParams = telemetryWithExp.filtersAndExp.exp.variables[
			ExpTreatmentVariables.CppContextProviderParams
		] as string;
		return cppContextProviderParams;
	}

	csharpContextProviderParams(telemetryWithExp: TelemetryWithExp): string | undefined {
		const csharpContextProviderParams = telemetryWithExp.filtersAndExp.exp.variables[
			ExpTreatmentVariables.CSharpContextProviderParams
		] as string;
		return csharpContextProviderParams;
	}

	javaContextProviderParams(telemetryWithExp: TelemetryWithExp): string | undefined {
		const javaContextProviderParams = telemetryWithExp.filtersAndExp.exp.variables[
			ExpTreatmentVariables.JavaContextProviderParams
		] as string;
		return javaContextProviderParams;
	}

	multiLanguageContextProviderParams(telemetryWithExp: TelemetryWithExp): string | undefined {
		const multiLanguageContextProviderParams = telemetryWithExp.filtersAndExp.exp.variables[
			ExpTreatmentVariables.MultiLanguageContextProviderParams
		] as string;
		return multiLanguageContextProviderParams;
	}

	tsContextProviderParams(telemetryWithExp: TelemetryWithExp): string | undefined {
		const tsContextProviderParams = telemetryWithExp.filtersAndExp.exp.variables[
			ExpTreatmentVariables.TsContextProviderParams
		] as string;
		return tsContextProviderParams;
	}

	completionsDebounce(telemetryWithExp: TelemetryWithExp): number | undefined {
		return telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.CompletionsDebounce] as
			| number
			| undefined;
	}

	enableElectronFetcher(telemetryWithExp: TelemetryWithExp): boolean {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.ElectronFetcher] as boolean) ?? false
		);
	}

	enableFetchFetcher(telemetryWithExp: TelemetryWithExp): boolean {
		return (telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.FetchFetcher] as boolean) ?? false;
	}

	asyncCompletionsTimeout(telemetryWithExp: TelemetryWithExp): number {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.AsyncCompletionsTimeout] as number) ??
			200
		);
	}

	enableProgressiveReveal(telemetryWithExp: TelemetryWithExp): boolean {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.ProgressiveReveal] as boolean) ?? false
		);
	}

	modelAlwaysTerminatesSingleline(telemetryWithExp: TelemetryWithExp): boolean {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[
				ExpTreatmentVariables.ModelAlwaysTerminatesSingleline
			] as boolean) ?? true
		);
	}

	longLookaheadSize(telemetryWithExp: TelemetryWithExp): number {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[
				ExpTreatmentVariables.ProgressiveRevealLongLookaheadSize
			] as number) ?? 9
		);
	}

	shortLookaheadSize(telemetryWithExp: TelemetryWithExp): number {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[
				ExpTreatmentVariables.ProgressiveRevealShortLookaheadSize
			] as number) ?? 3
		);
	}

	maxMultilineTokens(telemetryWithExp: TelemetryWithExp): number {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.MaxMultilineTokens] as number) ?? 200
		);
	}

	multilineAfterAcceptLines(telemetryWithExp: TelemetryWithExp): number {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.MultilineAfterAcceptLines] as number) ??
			1
		);
	}

	completionsDelay(telemetryWithExp: TelemetryWithExp): number {
		return (telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.CompletionsDelay] as number) ?? 200;
	}

	singleLineUnlessAccepted(telemetryWithExp: TelemetryWithExp): boolean {
		return (
			(telemetryWithExp.filtersAndExp.exp.variables[ExpTreatmentVariables.SingleLineUnlessAccepted] as boolean) ??
			false
		);
	}
}
