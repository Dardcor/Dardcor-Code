/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Result } from '../../../../util/common/result';
import { assertNever } from '../../../../util/dardcor/base/common/assert';
import { IValidator, vArray, vBoolean, vEnum, vNumber, vObj, vRequired, vString, vUndefined, vUnion } from '../../../configuration/common/validator';
import { ImportChanges } from './importFilteringOptions';

export enum IncludeLineNumbersOption {
	WithSpaceAfter = 'withSpaceAfter',
	WithoutSpace = 'withoutSpaceAfter',
	None = 'none',
}

export enum RecentFileClippingStrategy {
	AroundEditRange = 'aroundEditRange',
	Proportional = 'proportional',
}

export namespace RecentFileClippingStrategy {
	export const VALIDATOR = vEnum(RecentFileClippingStrategy.AroundEditRange, RecentFileClippingStrategy.Proportional);
}

export type RecentlyViewedDocumentsOptions = {
	readonly nDocuments: number;
	readonly maxTokens: number;
	readonly includeViewedFiles: boolean;
	readonly includeLineNumbers: IncludeLineNumbersOption;
	readonly clippingStrategy: RecentFileClippingStrategy;
	readonly useLeftoverBudgetFromAbove: boolean;
};

export namespace RecentlyViewedDocumentsOptions {
	export const VALIDATOR: IValidator<Partial<RecentlyViewedDocumentsOptions>> = vObj({
		'nDocuments': vNumber(),
		'maxTokens': vNumber(),
		'includeViewedFiles': vBoolean(),
		'includeLineNumbers': vEnum(IncludeLineNumbersOption.WithSpaceAfter, IncludeLineNumbersOption.WithoutSpace, IncludeLineNumbersOption.None),
		'clippingStrategy': vEnum(RecentFileClippingStrategy.AroundEditRange, RecentFileClippingStrategy.Proportional),
		'useLeftoverBudgetFromAbove': vBoolean(),
	});
}

export type LanguageContextLanguages = { [languageId: string]: boolean };

export type LanguageContextOptions = {
	readonly enabled: boolean;
	readonly maxTokens: number;
	readonly traitPosition: 'before' | 'after';
};

export type NeighborFilesOptions = {
	readonly enabled: boolean;
	readonly maxTokens: number;
	readonly includeRelatedFiles: boolean;
};

export namespace NeighborFilesOptions {
	export const VALIDATOR: IValidator<Partial<NeighborFilesOptions>> = vObj({
		'enabled': vBoolean(),
		'maxTokens': vNumber(),
		'includeRelatedFiles': vBoolean(),
	});
}

export type DiffHistoryOptions = {
	readonly nEntries: number;
	readonly maxTokens: number;
	readonly onlyForDocsInPrompt: boolean;
	readonly useRelativePaths: boolean;
};

export type GlobalBudgetPart =
	| 'recentlyViewedDocuments'
	| 'languageContext'
	| 'neighborFiles'
	| 'diffHistory';

export type GlobalBudgetSharePart = GlobalBudgetPart | 'currentFile';

export type GlobalBudgetOptions = {
	readonly totalTokens: number;
	readonly order: readonly GlobalBudgetPart[];
	readonly shares: Readonly<Record<GlobalBudgetSharePart, number>>;
};

export namespace GlobalBudgetOptions {
	export const DEFAULT_ORDER: readonly GlobalBudgetPart[] = [
		'languageContext',
		'recentlyViewedDocuments',
		'neighborFiles',
		'diffHistory',
	];

	export const DEFAULT_SHARES: Readonly<Record<GlobalBudgetSharePart, number>> = {
		currentFile: 1500 / 7500,
		recentlyViewedDocuments: 2000 / 7500,
		languageContext: 2000 / 7500,
		neighborFiles: 1000 / 7500,
		diffHistory: 1000 / 7500,
	};

	export const DEFAULT_TOTAL_TOKENS = 7500;






	export function currentFileBudget(globalBudget: GlobalBudgetOptions): number {
		return Math.max(0, Math.floor(globalBudget.totalTokens * (globalBudget.shares.currentFile ?? 0)));
	}

	export function validate(globalBudget: GlobalBudgetOptions): void {
		if (!Number.isFinite(globalBudget.totalTokens) || globalBudget.totalTokens < 0) {
			throw new Error(`globalBudget.totalTokens must be a finite, non-negative number, got ${globalBudget.totalTokens}`);
		}

		const seen = new Set<string>();
		for (const part of globalBudget.order) {
			if (seen.has(part)) {
				throw new Error(`globalBudget.order contains duplicate part '${part}'`);
			}
			seen.add(part);
			if (typeof globalBudget.shares[part] !== 'number') {
				throw new Error(`globalBudget.shares is missing entry for '${part}'`);
			}
			if (!Number.isFinite(globalBudget.shares[part]) || globalBudget.shares[part] < 0) {
				throw new Error(`globalBudget.shares['${part}'] must be a finite, non-negative number, got ${globalBudget.shares[part]}`);
			}
		}

		if (typeof globalBudget.shares.currentFile !== 'number') {
			throw new Error(`globalBudget.shares is missing entry for 'currentFile'`);
		}
		if (!Number.isFinite(globalBudget.shares.currentFile) || globalBudget.shares.currentFile < 0) {
			throw new Error(`globalBudget.shares['currentFile'] must be a finite, non-negative number, got ${globalBudget.shares.currentFile}`);
		}

		const recentIdx = globalBudget.order.indexOf('recentlyViewedDocuments');
		const neighborIdx = globalBudget.order.indexOf('neighborFiles');
		if (recentIdx !== -1 && neighborIdx !== -1 && neighborIdx < recentIdx) {
			throw new Error(`globalBudget.order must place 'recentlyViewedDocuments' before 'neighborFiles'`);
		}

		const sharesSum = globalBudget.order.reduce((sum, part) => sum + globalBudget.shares[part], 0) + globalBudget.shares.currentFile;
		const epsilon = 1e-3;
		if (Math.abs(sharesSum - 1) > epsilon) {
			throw new Error(`globalBudget.shares across order must sum to ~1, got ${sharesSum}`);
		}
	}

	export const VALIDATOR = vObj({
		'totalTokens': vUnion(vNumber(), vUndefined()),
		'order': vUnion(vArray(vEnum<GlobalBudgetPart[]>('languageContext', 'recentlyViewedDocuments', 'neighborFiles', 'diffHistory')), vUndefined()),
		'shares': vUnion(vObj({
			'currentFile': vRequired(vNumber()),
			'recentlyViewedDocuments': vRequired(vNumber()),
			'languageContext': vRequired(vNumber()),
			'neighborFiles': vRequired(vNumber()),
			'diffHistory': vRequired(vNumber()),
		}), vUndefined()),
	});














	export function fromConfigString(configString: string): Result<GlobalBudgetOptions, string> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(configString);
		} catch (e) {
			return Result.error(`Failed to parse globalBudget config string: ${e instanceof Error ? e.message : String(e)}`);
		}

		const { content, error } = VALIDATOR.validate(parsed);
		if (error) {
			return Result.error(`globalBudget config validation failed: ${error.message}`);
		}

		const options: GlobalBudgetOptions = {
			totalTokens: content.totalTokens ?? DEFAULT_TOTAL_TOKENS,
			order: content.order ?? DEFAULT_ORDER,
			shares: content.shares ?? DEFAULT_SHARES,
		};

		try {
			validate(options);
		} catch (e) {
			return Result.error(e instanceof Error ? e.message : String(e));
		}

		return Result.ok(options);
	}
}

export type PagedClipping = { pageSize: number };

export type CurrentFileOptions = {
	readonly maxTokens: number;
	readonly includeTags: boolean;
	readonly includeLineNumbers: IncludeLineNumbersOption;
	readonly includeCursorTag: boolean;
	readonly prioritizeAboveCursor: boolean;
	readonly useLeftoverBudgetFromAbove: boolean;
};

export namespace CurrentFileOptions {
	export const VALIDATOR: IValidator<Partial<CurrentFileOptions>> = vObj({
		'maxTokens': vNumber(),
		'includeTags': vBoolean(),
		'includeLineNumbers': vEnum(IncludeLineNumbersOption.WithSpaceAfter, IncludeLineNumbersOption.WithoutSpace, IncludeLineNumbersOption.None),
		'includeCursorTag': vBoolean(),
		'prioritizeAboveCursor': vBoolean(),
		'useLeftoverBudgetFromAbove': vBoolean(),
	});
}

export enum LintOptionWarning {
	YES = 'yes',
	NO = 'no',
	YES_IF_NO_ERRORS = 'yesIfNoErrors',
}
export enum LintOptionShowCode {
	YES = 'yes',
	NO = 'no',
	YES_WITH_SURROUNDING = 'yesWithSurroundingLines',
}
export type LintOptions = {
	tagName: string;
	warnings: LintOptionWarning;
	showCode: LintOptionShowCode;
	maxLints: number;
	maxLineDistance: number;
	nRecentFiles: number;
};

export enum AggressivenessSetting {
	Default = 'auto',
	Low = 'low',
	Medium = 'medium',
	High = 'high',
}

export enum AggressivenessLevel {
	Low = 'low',
	Medium = 'medium',
	High = 'high',
}

export enum EarlyDivergenceCancellationMode {
	Cursor = 'cursor',
	EditWindow = 'editWindow',
	Off = 'off',
}

export namespace EarlyDivergenceCancellationMode {
	export const VALIDATOR = vEnum(EarlyDivergenceCancellationMode.Cursor, EarlyDivergenceCancellationMode.EditWindow, EarlyDivergenceCancellationMode.Off);
}

export namespace AggressivenessSetting {
	export const VALIDATOR = vEnum(AggressivenessSetting.Default, AggressivenessSetting.Low, AggressivenessSetting.Medium, AggressivenessSetting.High);

	export function toLevel(setting: AggressivenessSetting): AggressivenessLevel | undefined {
		switch (setting) {
			case AggressivenessSetting.Low: return AggressivenessLevel.Low;
			case AggressivenessSetting.Medium: return AggressivenessLevel.Medium;
			case AggressivenessSetting.High: return AggressivenessLevel.High;
			case AggressivenessSetting.Default: return undefined;
		}
	}
}

export enum EditIntent {
	NoEdit = 'no_edit',
	Low = 'low',
	Medium = 'medium',
	High = 'high',
}

export namespace EditIntent {
	export function fromString(value: string): EditIntent {
		switch (value) {
			case 'no_edit':
				return EditIntent.NoEdit;
			case 'low':
				return EditIntent.Low;
			case 'medium':
				return EditIntent.Medium;
			case 'high':
				return EditIntent.High;
			default:
				return EditIntent.High;
		}
	}

	export function fromShortName(value: string): EditIntent | undefined {
		switch (value) {
			case 'N':
				return EditIntent.NoEdit;
			case 'L':
				return EditIntent.Low;
			case 'M':
				return EditIntent.Medium;
			case 'H':
				return EditIntent.High;
			default:
				return undefined;
		}
	}

	export function shouldShowEdit(editIntent: EditIntent, aggressivenessLevel: AggressivenessLevel): boolean {
		switch (editIntent) {
			case EditIntent.NoEdit:
				return false;
			case EditIntent.High:
				return true;
			case EditIntent.Medium:
				return aggressivenessLevel === AggressivenessLevel.Medium ||
					aggressivenessLevel === AggressivenessLevel.High;
			case EditIntent.Low:
				return aggressivenessLevel === AggressivenessLevel.High;
			default:
				assertNever(editIntent);
		}
	}
}

export type PromptOptions = {
	readonly promptingStrategy: PromptingStrategy | undefined ;
	readonly currentFile: CurrentFileOptions;
	readonly pagedClipping: PagedClipping;
	readonly recentlyViewedDocuments: RecentlyViewedDocumentsOptions;
	readonly languageContext: LanguageContextOptions;
	readonly neighborFiles: NeighborFilesOptions;
	readonly diffHistory: DiffHistoryOptions;
	readonly includePostScript: boolean;
	readonly lintOptions: LintOptions | undefined;
	readonly globalBudget?: GlobalBudgetOptions;
};

export enum PromptingStrategy {
	DardcorNesXtab = 'dardcorNesXtab',
	UnifiedModel = 'xtabUnifiedModel',
	Codexv21NesUnified = 'codexv21nesUnified',
	Nes41Miniv3 = 'nes41miniv3',
	SimplifiedSystemPrompt = 'simplifiedSystemPrompt',
	Xtab275 = 'xtab275',
	XtabAggressiveness = 'xtabAggressiveness',
	Xtab275Aggressiveness = 'xtab275Aggressiveness',
	Xtab275AggressivenessHighLow = 'xtab275AggressivenessHighLow',
	PatchBased = 'patchBased',
	PatchBased01 = 'patchBased01',
	PatchBased02 = 'patchBased02',
	PatchBased02WithRecentLineNumbers = 'patchBased02WithRecentLineNumbers',
	PatchBased02WithoutRecentLineNumbers = 'patchBased02WithoutRecentLineNumbers',
	Xtab275EditIntent = 'xtab275EditIntent',
	Xtab275EditIntentShort = 'xtab275EditIntentShort',
}

export function isPromptingStrategy(value: string): value is PromptingStrategy {
	return (Object.values(PromptingStrategy) as string[]).includes(value);
}

export function isAggressivenessStrategy(strategy: PromptingStrategy | undefined): boolean {
	return strategy === PromptingStrategy.XtabAggressiveness
		|| strategy === PromptingStrategy.Xtab275Aggressiveness
		|| strategy === PromptingStrategy.Xtab275AggressivenessHighLow
		|| strategy === PromptingStrategy.Xtab275EditIntent
		|| strategy === PromptingStrategy.Xtab275EditIntentShort;
}

export enum ResponseFormat {
	CodeBlock = 'codeBlock',
	UnifiedWithXml = 'unifiedWithXml',
	EditWindowOnly = 'editWindowOnly',
	CustomDiffPatch = 'customDiffPatch',
	EditWindowWithEditIntent = 'editWindowWithEditIntent',
	EditWindowWithEditIntentShort = 'editWindowWithEditIntentShort',
}

export namespace ResponseFormat {
	export function fromPromptingStrategy(strategy: PromptingStrategy | undefined): ResponseFormat {
		switch (strategy) {
			case PromptingStrategy.UnifiedModel:
			case PromptingStrategy.Codexv21NesUnified:
			case PromptingStrategy.Nes41Miniv3:
				return ResponseFormat.UnifiedWithXml;
			case PromptingStrategy.Xtab275:
			case PromptingStrategy.XtabAggressiveness:
			case PromptingStrategy.Xtab275Aggressiveness:
			case PromptingStrategy.Xtab275AggressivenessHighLow:
				return ResponseFormat.EditWindowOnly;
			case PromptingStrategy.PatchBased:
			case PromptingStrategy.PatchBased01:
			case PromptingStrategy.PatchBased02:
			case PromptingStrategy.PatchBased02WithRecentLineNumbers:
			case PromptingStrategy.PatchBased02WithoutRecentLineNumbers:
				return ResponseFormat.CustomDiffPatch;
			case PromptingStrategy.Xtab275EditIntent:
				return ResponseFormat.EditWindowWithEditIntent;
			case PromptingStrategy.Xtab275EditIntentShort:
				return ResponseFormat.EditWindowWithEditIntentShort;
			case PromptingStrategy.SimplifiedSystemPrompt:
			case PromptingStrategy.DardcorNesXtab:
			case undefined:
				return ResponseFormat.CodeBlock;
			default:
				assertNever(strategy);
		}
	}
}

export const DEFAULT_OPTIONS: PromptOptions = {
	promptingStrategy: undefined,
	currentFile: {
		maxTokens: 1500,
		includeTags: true,
		includeLineNumbers: IncludeLineNumbersOption.None,
		includeCursorTag: false,
		prioritizeAboveCursor: false,
		useLeftoverBudgetFromAbove: true,
	},
	pagedClipping: {
		pageSize: 10,
	},
	recentlyViewedDocuments: {
		nDocuments: 5,
		maxTokens: 2000,
		includeViewedFiles: false,
		includeLineNumbers: IncludeLineNumbersOption.None,
		clippingStrategy: RecentFileClippingStrategy.AroundEditRange,
		useLeftoverBudgetFromAbove: false,
	},
	languageContext: {
		enabled: false,
		maxTokens: 2000,
		traitPosition: 'after',
	},
	neighborFiles: {
		enabled: false,
		maxTokens: 1000,
		includeRelatedFiles: true,
	},
	diffHistory: {
		nEntries: 25,
		maxTokens: 1000,
		onlyForDocsInPrompt: false,
		useRelativePaths: false,
	},
	lintOptions: undefined,
	includePostScript: true,
};

export const DEFAULT_CURSOR_PREDICTION_LINT_OPTIONS: LintOptions = {
	maxLineDistance: 1000,
	maxLints: 5,
	showCode: LintOptionShowCode.YES_WITH_SURROUNDING,
	tagName: 'linter',
	warnings: LintOptionWarning.YES_IF_NO_ERRORS,
	nRecentFiles: 0,
};

export const LANGUAGE_CONTEXT_ENABLED_LANGUAGES: LanguageContextLanguages = {
	'prompt': true,
	'instructions': true,
	'chatagent': true,
};

export interface ModelConfiguration {
	modelName: string;
	promptingStrategy: PromptingStrategy | undefined ;
	includeTagsInCurrentFile: boolean;
	includePostScript?: boolean;
	currentFile?: Partial<CurrentFileOptions>;
	recentlyViewedDocuments?: Partial<RecentlyViewedDocumentsOptions>;
	lintOptions: Partial<LintOptions> | undefined;
	supportsNextCursorLinePrediction?: boolean;
	allowImportChanges?: ImportChanges;
}

const STRATEGY_CONFIG: Partial<Record<PromptingStrategy, Partial<ModelConfiguration>>> = {
	[PromptingStrategy.DardcorNesXtab]: {
		includeTagsInCurrentFile: true,
	},
	[PromptingStrategy.PatchBased02WithRecentLineNumbers]: {
		includeTagsInCurrentFile: false,
		includePostScript: true,
		currentFile: { includeLineNumbers: IncludeLineNumbersOption.WithoutSpace },
		recentlyViewedDocuments: { includeLineNumbers: IncludeLineNumbersOption.WithoutSpace },
		supportsNextCursorLinePrediction: false,
		allowImportChanges: ImportChanges.All,
	},
	[PromptingStrategy.PatchBased02WithoutRecentLineNumbers]: {
		includeTagsInCurrentFile: false,
		includePostScript: true,
		currentFile: { includeLineNumbers: IncludeLineNumbersOption.WithoutSpace },
		recentlyViewedDocuments: { includeLineNumbers: IncludeLineNumbersOption.None },
		supportsNextCursorLinePrediction: false,
		allowImportChanges: ImportChanges.All,
	},
};

export function applyStrategyConfig(config: ModelConfiguration): ModelConfiguration {
	const overrides = config.promptingStrategy === undefined ? undefined : STRATEGY_CONFIG[config.promptingStrategy];
	if (!overrides) {
		return config;
	}
	const hasCurrentFile = config.currentFile !== undefined || overrides.currentFile !== undefined;
	const hasRecentlyViewed = config.recentlyViewedDocuments !== undefined || overrides.recentlyViewedDocuments !== undefined;
	const hasLintOptions = config.lintOptions !== undefined || overrides.lintOptions !== undefined;
	return {
		...config,
		...overrides,
		currentFile: hasCurrentFile ? { ...config.currentFile, ...overrides.currentFile } : undefined,
		recentlyViewedDocuments: hasRecentlyViewed ? { ...config.recentlyViewedDocuments, ...overrides.recentlyViewedDocuments } : undefined,
		lintOptions: hasLintOptions ? { ...config.lintOptions, ...overrides.lintOptions } : undefined,
	};
}

export const LINT_OPTIONS_VALIDATOR: IValidator<Partial<LintOptions>> = vObj({
	'tagName': vString(),
	'warnings': vEnum(LintOptionWarning.YES, LintOptionWarning.NO, LintOptionWarning.YES_IF_NO_ERRORS),
	'showCode': vEnum(LintOptionShowCode.NO, LintOptionShowCode.YES, LintOptionShowCode.YES_WITH_SURROUNDING),
	'maxLints': vNumber(),
	'maxLineDistance': vNumber(),
	'nRecentFiles': vNumber(),
});

export const MODEL_CONFIGURATION_VALIDATOR: IValidator<ModelConfiguration> = vObj({
	'modelName': vRequired(vString()),
	'promptingStrategy': vUnion(vEnum(...Object.values(PromptingStrategy)), vUndefined()),
	'includeTagsInCurrentFile': vRequired(vBoolean()),
	'includePostScript': vUnion(vBoolean(), vUndefined()),
	'currentFile': vUnion(CurrentFileOptions.VALIDATOR, vUndefined()),
	'recentlyViewedDocuments': vUnion(RecentlyViewedDocumentsOptions.VALIDATOR, vUndefined()),
	'lintOptions': vUnion(LINT_OPTIONS_VALIDATOR, vUndefined()),
	'supportsNextCursorLinePrediction': vUnion(vBoolean(), vUndefined()),
	'allowImportChanges': vUnion(ImportChanges.VALIDATOR, vUndefined()),
});

export function parseLintOptionString(optionString: string, defaults: LintOptions): LintOptions {
	try {
		const parsed = JSON.parse(optionString);

		const lintValidation = LINT_OPTIONS_VALIDATOR.validate(parsed);
		if (lintValidation.error) {
			throw new Error(`Lint options validation failed: ${lintValidation.error.message}`);
		}

		return { ...defaults, ...lintValidation.content };
	} catch (e) {
		throw new Error(`Failed to parse lint options string: ${e}`);
	}
}

export interface UserHappinessScoreConfiguration {
	acceptedScore: number;
	rejectedScore: number;
	ignoredScore: number;
	highThreshold: number;
	mediumThreshold: number;
	includeIgnored: boolean;
	ignoredLimit: number;
	limitConsecutiveIgnored: boolean;
	limitTotalIgnored: boolean;
}

export const DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION: UserHappinessScoreConfiguration = {
	acceptedScore: 1,
	rejectedScore: 0,
	ignoredScore: 0.5,
	highThreshold: 0.7,
	mediumThreshold: 0.4,
	includeIgnored: false,
	ignoredLimit: 0,
	limitConsecutiveIgnored: false,
	limitTotalIgnored: true,
};

const USER_HAPPINESS_SCORE_CONFIGURATION_BASE_VALIDATOR: IValidator<UserHappinessScoreConfiguration> = vObj({
	'acceptedScore': vRequired(vNumber()),
	'rejectedScore': vRequired(vNumber()),
	'ignoredScore': vRequired(vNumber()),
	'highThreshold': vRequired(vNumber()),
	'mediumThreshold': vRequired(vNumber()),
	'includeIgnored': vRequired(vBoolean()),
	'ignoredLimit': vRequired(vNumber()),
	'limitConsecutiveIgnored': vRequired(vBoolean()),
	'limitTotalIgnored': vRequired(vBoolean()),
});

function isInRange(value: number, min: number, max: number): boolean {
	return value >= min && value <= max;
}

export const USER_HAPPINESS_SCORE_CONFIGURATION_VALIDATOR: IValidator<UserHappinessScoreConfiguration> = {
	validate(content: unknown) {
		const baseResult = USER_HAPPINESS_SCORE_CONFIGURATION_BASE_VALIDATOR.validate(content);
		if (baseResult.error) {
			return baseResult;
		}

		const config = baseResult.content;

		if (!isInRange(config.acceptedScore, 0, 1)) {
			return { content: undefined, error: { message: 'acceptedScore must be in range [0, 1]' } };
		}
		if (!isInRange(config.rejectedScore, 0, 1)) {
			return { content: undefined, error: { message: 'rejectedScore must be in range [0, 1]' } };
		}
		if (!isInRange(config.ignoredScore, 0, 1)) {
			return { content: undefined, error: { message: 'ignoredScore must be in range [0, 1]' } };
		}

		if (!isInRange(config.highThreshold, 0, 1)) {
			return { content: undefined, error: { message: 'highThreshold must be in range [0, 1]' } };
		}
		if (!isInRange(config.mediumThreshold, 0, 1)) {
			return { content: undefined, error: { message: 'mediumThreshold must be in range [0, 1]' } };
		}

		if (config.acceptedScore <= config.rejectedScore) {
			return { content: undefined, error: { message: 'acceptedScore must be greater than rejectedScore to prevent division by zero' } };
		}

		if (config.ignoredScore < config.rejectedScore) {
			return { content: undefined, error: { message: 'ignoredScore must be greater than or equal to rejectedScore to prevent exceeding bounds' } };
		}
		if (config.acceptedScore < config.ignoredScore) {
			return { content: undefined, error: { message: 'acceptedScore must be greater than or equal to ignoredScore to prevent exceeding bounds' } };
		}

		if (config.highThreshold <= config.mediumThreshold) {
			return { content: undefined, error: { message: 'highThreshold must be greater than mediumThreshold' } };
		}

		if (config.ignoredLimit < 0) {
			return { content: undefined, error: { message: 'ignoredLimit must be non-negative' } };
		}

		return { content: config, error: undefined };
	},
	toSchema() {
		return USER_HAPPINESS_SCORE_CONFIGURATION_BASE_VALIDATOR.toSchema();
	}
};

export function parseUserHappinessScoreConfigurationString(optionString: string): UserHappinessScoreConfiguration {
	try {
		const parsed = JSON.parse(optionString);

		const validation = USER_HAPPINESS_SCORE_CONFIGURATION_VALIDATOR.validate(parsed);
		if (validation.error) {
			throw new Error(`User happiness score configuration validation failed: ${validation.error.message}`);
		}

		return validation.content;
	} catch (e) {
		throw new Error(`Failed to parse user happiness score configuration string: ${e}`);
	}
}

export enum SpeculativeRequestsEnablement {
	On = 'on',
	Off = 'off',
}

export namespace SpeculativeRequestsEnablement {
	export const VALIDATOR = vEnum(SpeculativeRequestsEnablement.On, SpeculativeRequestsEnablement.Off);
}

export enum DuplicateAdditionsMode {
	Off = 'off',
	DropPatch = 'dropPatch',
	DropAllRemaining = 'dropAllRemaining',
	TrimDuplicate = 'trimDuplicate',
}

export namespace DuplicateAdditionsMode {
	export const VALIDATOR = vEnum(
		DuplicateAdditionsMode.Off,
		DuplicateAdditionsMode.DropPatch,
		DuplicateAdditionsMode.DropAllRemaining,
		DuplicateAdditionsMode.TrimDuplicate,
	);
}

export enum SpeculativeRequestsCursorPlacement {
	AfterEditApplied = 'afterEditApplied',
	AfterEditWindow = 'afterEditWindow',
}

export namespace SpeculativeRequestsCursorPlacement {
	export const VALIDATOR = vEnum(SpeculativeRequestsCursorPlacement.AfterEditApplied, SpeculativeRequestsCursorPlacement.AfterEditWindow);
}

export enum SpeculativeRequestsAutoExpandEditWindowLines {
	Off = 'off',
	Smart = 'smart',
	Always = 'always',
}

export namespace SpeculativeRequestsAutoExpandEditWindowLines {
	export const VALIDATOR = vEnum(SpeculativeRequestsAutoExpandEditWindowLines.Off, SpeculativeRequestsAutoExpandEditWindowLines.Smart, SpeculativeRequestsAutoExpandEditWindowLines.Always);
}

export enum PatchModelPrediction {
	FilePath = 'filePath',
	CurrentLine = 'currentLine',
	CurrentLineReplaced = 'currentLineReplaced',
	CurrentLineCompleted = 'currentLineCompleted',
}

export namespace PatchModelPrediction {
	export const VALIDATOR = vEnum(
		PatchModelPrediction.FilePath,
		PatchModelPrediction.CurrentLine,
		PatchModelPrediction.CurrentLineReplaced,
		PatchModelPrediction.CurrentLineCompleted
	);
}
