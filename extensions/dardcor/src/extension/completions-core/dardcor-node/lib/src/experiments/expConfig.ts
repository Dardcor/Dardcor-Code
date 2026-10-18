/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from '../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { TelemetryData, telemetryExpProblem } from '../telemetry';
import { ExpServiceTelemetryNames } from './telemetryNames';

export enum ExpTreatmentVariables {
	CustomEngine = 'dardcorcustomengine',
	CustomEngineTargetEngine = 'dardcorcustomenginetargetengine',

	OverrideBlockMode = 'dardcoroverrideblockmode',
	SuffixPercent = 'DardcorSuffixPercent',
	CppHeadersEnableSwitch = 'dardcorcppheadersenableswitch',
	UseSubsetMatching = 'dardcorsubsetmatching',

	SuffixMatchThreshold = 'dardcorsuffixmatchthreshold',

	MaxPromptCompletionTokens = 'maxpromptcompletionTokens',

	StableContextPercent = 'dardcorstablecontextpercent',
	VolatileContextPercent = 'dardcorvolatilecontextpercent',

	RelatedFilesVSCodeCSharp = 'dardcorrelatedfilesvscodecsharp',
	RelatedFilesVSCodeTypeScript = 'dardcorrelatedfilesvscodetypescript',
	RelatedFilesVSCode = 'dardcorrelatedfilesvscode',

	ContextProviders = 'dardcorcontextproviders',
	IncludeNeighboringFiles = 'dardcorincludeneighboringfiles',
	ExcludeRelatedFiles = 'dardcorexcluderelatedfiles',
	ContextProviderTimeBudget = 'dardcorcontextprovidertimebudget',

	CppContextProviderParams = 'dardcorcppContextProviderParams',

	CSharpContextProviderParams = 'dardcorcsharpcontextproviderparams',

	JavaContextProviderParams = 'dardcorjavacontextproviderparams',

	MultiLanguageContextProviderParams = 'dardcormultilanguagecontextproviderparams',

	TsContextProviderParams = 'dardcortscontextproviderparams',

	CompletionsDebounce = 'dardcorcompletionsdebounce',

	ElectronFetcher = 'dardcorelectronfetcher',
	FetchFetcher = 'dardcorfetchfetcher',

	AsyncCompletionsTimeout = 'dardcorasynccompletionstimeout',

	EnablePromptContextProxyField = 'dardcorenablepromptcontextproxyfield',

	ProgressiveReveal = 'dardcorprogressivereveal',
	ModelAlwaysTerminatesSingleline = 'dardcormodelterminatesingleline',
	ProgressiveRevealLongLookaheadSize = 'dardcorprogressivereveallonglookaheadsize',
	ProgressiveRevealShortLookaheadSize = 'dardcorprogressiverevealshortlookaheadsize',
	MaxMultilineTokens = 'dardcormaxmultilinetokens',

	MultilineAfterAcceptLines = 'dardcormultilineafteracceptlines',

	CompletionsDelay = 'dardcorcompletionsdelay',

	SingleLineUnlessAccepted = 'dardcorsinglelineunlessaccepted',
}

export type ExpTreatmentVariableValue = boolean | string | number;

export class ExpConfig {
	variables: Partial<Record<ExpTreatmentVariables, ExpTreatmentVariableValue>>;
	features: string;

	constructor(
		variables: Partial<Record<ExpTreatmentVariables, ExpTreatmentVariableValue>>,
		features: string
	) {
		this.variables = variables;
		this.features = features;
	}

	static createFallbackConfig(accessor: ServicesAccessor, reason: string): ExpConfig {
		telemetryExpProblem(accessor, { reason });
		return this.createEmptyConfig();
	}

	static createEmptyConfig() {
		return new ExpConfig({}, '');
	}

	addToTelemetry(telemetryData: TelemetryData): void {
		telemetryData.properties[ExpServiceTelemetryNames.featuresTelemetryPropertyName] = this.features;
	}
}
