/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import * as platform from '../../../base/common/platform.js';
import type { IExperimentationFilterProvider } from 'tas-client';

export const ASSIGNMENT_STORAGE_KEY = 'VSCode.ABExp.FeatureData';
export const ASSIGNMENT_REFETCH_INTERVAL = 60 * 60 * 1000;

export interface IAssignmentService {
	readonly _serviceBrand: undefined;

	readonly onDidRefetchAssignments: Event<void>;
	getTreatment<T extends string | number | boolean>(name: string): Promise<T | undefined>;
}

export enum TargetPopulation {
	Insiders = 'insider',
	Public = 'public',
	Exploration = 'exploration'
}

export enum Filters {
	Market = 'X-MSEdge-Market',

	CorpNet = 'X-FD-Corpnet',

	ApplicationVersion = 'X-VSCode-AppVersion',

	Build = 'X-VSCode-Build',

	ClientId = 'X-MSEdge-ClientId',

	DeveloperDeviceId = 'X-VSCode-DevDeviceId',

	ExtensionName = 'X-VSCode-ExtensionName',

	ExtensionVersion = 'X-VSCode-ExtensionVersion',

	Language = 'X-VSCode-Language',

	TargetPopulation = 'X-VSCode-TargetPopulation',

	Platform = 'X-VSCode-Platform',

	ReleaseDate = 'X-VSCode-ReleaseDate',

	WindowKind = 'X-VSCode-WindowKind',
}

export const enum WindowKind {
	Editor = 'editor',
	Agents = 'agents',
}

export class AssignmentFilterProvider implements IExperimentationFilterProvider {
	constructor(
		private version: string,
		private appName: string,
		private machineId: string,
		private devDeviceId: string,
		private targetPopulation: TargetPopulation,
		private releaseDate: string,
		private windowKind: WindowKind
	) { }

	getFilterValue(filter: string): string | null {
		switch (filter) {
			case Filters.ApplicationVersion:
				return trimVersionSuffix(this.version);
			case Filters.Build:
				return this.appName;
			case Filters.ClientId:
				return this.machineId;
			case Filters.DeveloperDeviceId:
				return this.devDeviceId;
			case Filters.Language:
				return platform.language;
			case Filters.ExtensionName:
				return 'vscode-core';
			case Filters.ExtensionVersion:
				return '999999.0';
			case Filters.TargetPopulation:
				return this.targetPopulation;
			case Filters.Platform:
				return platform.PlatformToString(platform.platform);
			case Filters.ReleaseDate:
				return formatReleaseDate(this.releaseDate);
			case Filters.WindowKind:
				return this.windowKind;
			default:
				return '';
		}
	}

	getFilters(): Map<string, unknown> {
		const filters: Map<string, unknown> = new Map<string, unknown>();
		const filterValues = Object.values(Filters);
		for (const value of filterValues) {
			filters.set(value, this.getFilterValue(value));
		}

		return filters;
	}
}

function trimVersionSuffix(version: string): string {
	return version.split(/\-[a-zA-Z0-9]+$/)[0];
}

function formatReleaseDate(iso: string): string {
	if (!iso) {
		return '';
	}
	const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2})/.exec(iso);
	if (!match) {
		return '';
	}
	return match.slice(1, 5).join('');
}

export enum AssignmentsFilters {
	ApplicationVersion = 'vscode_core_appversion',
	Build = 'vscode_core_build',
	DeveloperDeviceId = 'devdeviceid',
	ExtensionName = 'vscode_core_extensionname',
	ExtensionNameShort = 'extensionname',
	TargetPopulation = 'vscode_core_targetpopulation',
	Platform = 'vscode_core_platform',
	ReleaseDate = 'vscode_core_releasedate',
	WindowKind = 'vscode_core_windowkind',
}

export class VSCodeCoreAssignmentsFilterProvider implements IExperimentationFilterProvider {
	constructor(
		private version: string,
		private appName: string,
		private devDeviceId: string,
		private targetPopulation: TargetPopulation,
		private releaseDate: string,
		private windowKind: WindowKind
	) { }

	getFilterValue(filter: string): string | null {
		switch (filter) {
			case AssignmentsFilters.ApplicationVersion:
				return trimVersionSuffix(this.version);
			case AssignmentsFilters.Build:
				return this.appName;
			case AssignmentsFilters.DeveloperDeviceId:
				return this.devDeviceId;
			case AssignmentsFilters.ExtensionName:
			case AssignmentsFilters.ExtensionNameShort:
				return 'vscode-core';
			case AssignmentsFilters.TargetPopulation:
				return this.targetPopulation;
			case AssignmentsFilters.Platform:
				return platform.PlatformToString(platform.platform);
			case AssignmentsFilters.ReleaseDate:
				return formatReleaseDate(this.releaseDate);
			case AssignmentsFilters.WindowKind:
				return this.windowKind;
			default:
				return null;
		}
	}

	getFilters(): Map<string, unknown> {
		const filters: Map<string, unknown> = new Map<string, unknown>();
		for (const value of Object.values(AssignmentsFilters)) {
			filters.set(value, this.getFilterValue(value));
		}

		return filters;
	}
}

export function getInternalOrg(organisations: readonly string[] | undefined): 'vscode' | 'github' | 'microsoft' | undefined {
	const isVSCodeInternal = organisations?.includes('Visual-Studio-Code');
	const isGitHubInternal = organisations?.includes('github');
	const isMicrosoftInternal = organisations?.includes('microsoft') || organisations?.includes('ms-copilot') || organisations?.includes('MicrosoftCopilot');
	return isVSCodeInternal ? 'vscode' : isGitHubInternal ? 'github' : isMicrosoftInternal ? 'microsoft' : undefined;
}

export function isInternalAccount(isStaff: boolean | undefined, organisations: readonly string[] | undefined): boolean {
	return isStaff === true || getInternalOrg(organisations) !== undefined;
}
