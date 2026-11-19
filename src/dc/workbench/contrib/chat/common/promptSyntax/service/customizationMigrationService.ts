/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { getComparisonKey } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IMcpServerConfiguration } from '../../../../../../platform/mcp/common/mcpPlatformTypes.js';
import { ChatConfiguration } from '../../constants.js';
import { PromptFileSource, PromptsType } from '../promptTypes.js';
import { PromptsStorage } from './promptsService.js';

export const ICustomizationMigrationService = createDecorator<ICustomizationMigrationService>('customizationMigrationService');

export enum CustomizationMigrationType {
	UserData = 'userData',
	PromptFiles = 'promptFiles',
	ConfiguredLocations = 'configuredLocations',
	McpServers = 'mcpServers',
}

export function getCustomizationMigrationEnablementSetting(type: CustomizationMigrationType): ChatConfiguration {
	switch (type) {
		case CustomizationMigrationType.UserData: return ChatConfiguration.ChatCustomizationsUserDataMigrationEnabled;
		case CustomizationMigrationType.PromptFiles: return ChatConfiguration.ChatCustomizationsPromptMigrationEnabled;
		case CustomizationMigrationType.ConfiguredLocations: return ChatConfiguration.ChatCustomizationsLocationsMigrationEnabled;
		case CustomizationMigrationType.McpServers: return ChatConfiguration.ChatCustomizationsMcpServerMigrationEnabled;
	}
}

export interface MigratableConfiguration {
	readonly uri: URI;
	readonly type: PromptsType;
	readonly storage: PromptsStorage;
	readonly name?: string;
	readonly description?: string;
	readonly source?: PromptFileSource;
}

export function getCustomizationMigrationTargetType(customization: MigratableConfiguration): PromptsType {
	return customization.type === PromptsType.prompt ? PromptsType.skill : customization.type;
}

export function isPromptFileMigrationCandidate(customization: MigratableConfiguration): boolean {
	return customization.type === PromptsType.prompt
		&& (customization.storage === PromptsStorage.local || customization.storage === PromptsStorage.user);
}

export function isUserDataMigrationCandidate(customization: MigratableConfiguration): boolean {
	return customization.source === PromptFileSource.UserData
		&& (customization.type === PromptsType.agent || customization.type === PromptsType.instructions);
}

export function isConfiguredLocationMigrationCandidate(customization: MigratableConfiguration): boolean {
	return (customization.source === PromptFileSource.ConfigWorkspace || customization.source === PromptFileSource.ConfigPersonal)
		&& (customization.type === PromptsType.agent || customization.type === PromptsType.instructions || customization.type === PromptsType.skill);
}

export type FileCustomizationMigrationType = CustomizationMigrationType.UserData | CustomizationMigrationType.PromptFiles | CustomizationMigrationType.ConfiguredLocations;

export interface FileCustomizationMigration {
	readonly type: FileCustomizationMigrationType;
	readonly files: readonly URI[];
	readonly candidates: readonly MigratableConfiguration[];
}

export interface IMcpServerCustomizationMigrationItem {
	readonly id: string;
	readonly name: string;
	readonly supported: boolean;
}

export interface IMcpServerCustomizationMigrationCandidate {
	readonly type: CustomizationMigrationType.McpServers;
	readonly id: string;
	readonly name: string;
	readonly sourceUri: URI;
	readonly targetUri: URI;
	readonly projectedConfiguration: IMcpServerConfiguration;
}

export function getMcpServerCustomizationMigrationCandidateKey(candidate: IMcpServerCustomizationMigrationCandidate): string {
	return JSON.stringify([
		candidate.id,
		candidate.name,
		getComparisonKey(candidate.sourceUri),
		getComparisonKey(candidate.targetUri),
	]);
}

export interface IAgentHostMcpServerSupportCoverage {
	readonly restrictedByMcpAccess: boolean;
	readonly restrictedByCustomizationPolicy: boolean;
}

export interface McpServerCustomizationMigration {
	readonly type: CustomizationMigrationType.McpServers;
	readonly servers: readonly IMcpServerCustomizationMigrationItem[];
	readonly candidates: readonly IMcpServerCustomizationMigrationCandidate[];
	readonly discoveryComplete: boolean;
	readonly coverage: IAgentHostMcpServerSupportCoverage;
}

export const enum McpServerCustomizationMigrationFailureReason {
	NoLongerEligible = 'noLongerEligible',
	SourceUnavailable = 'sourceUnavailable',
	InvalidSource = 'invalidSource',
	UnrepresentableConfiguration = 'unrepresentableConfiguration',
	SourceChanged = 'sourceChanged',
	InvalidTarget = 'invalidTarget',
	TargetConflict = 'targetConflict',
	CrossRootConflict = 'crossRootConflict',
	TargetChanged = 'targetChanged',
	WriteFailed = 'writeFailed',
	RollbackFailed = 'rollbackFailed',
	InconsistentTarget = 'inconsistentTarget',
}

export interface IMcpServerCustomizationMigrationFailure {
	readonly id: string;
	readonly name: string;
	readonly sourceUri: URI;
	readonly targetUri: URI;
	readonly reason: McpServerCustomizationMigrationFailureReason;
	readonly conflictingUri?: URI;
	readonly error?: Error;
}

export interface IMcpServerCustomizationMigrationResult {
	readonly migratedCount: number;
	readonly failures: readonly IMcpServerCustomizationMigrationFailure[];
}

export type CustomizationMigrationCandidate = MigratableConfiguration | IMcpServerCustomizationMigrationCandidate;

export function isMcpServerCustomizationMigrationCandidate(candidate: CustomizationMigrationCandidate): candidate is IMcpServerCustomizationMigrationCandidate {
	return candidate.type === CustomizationMigrationType.McpServers;
}

export type CustomizationMigration = FileCustomizationMigration | McpServerCustomizationMigration;

export const enum CustomizationMigrationHintTarget {
	FileMigrations = 'fileMigrations',
	McpServers = 'mcpServers',
}

export interface ICustomizationMigrationHint {
	readonly message: string;
	readonly target: CustomizationMigrationHintTarget;
}

export interface ICustomizationMigrationService {
	readonly _serviceBrand: undefined;

	computeMigration(sessionResource: URI, type: FileCustomizationMigrationType, token?: CancellationToken): Promise<FileCustomizationMigration>;
	computeMigration(sessionResource: URI, type: CustomizationMigrationType.McpServers, token?: CancellationToken): Promise<McpServerCustomizationMigration>;
	migrateMcpServers(sessionResource: URI, candidates: readonly IMcpServerCustomizationMigrationCandidate[]): Promise<IMcpServerCustomizationMigrationResult>;
	computeMigrations(sessionResource: URI, token?: CancellationToken): Promise<CustomizationMigration[]>;
	computeMigrationHint(sessionResource: URI, token?: CancellationToken): Promise<ICustomizationMigrationHint | undefined>;
}
