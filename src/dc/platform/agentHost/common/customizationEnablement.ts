/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CustomizationEnablementKind, type CustomizationEnablement, type SkillCustomization } from './state/protocol/state.js';

export const DEFAULT_CUSTOMIZATION_ENABLED = true;

export type CustomizationDisabledReason =
	| {
		readonly source: 'scope';
		readonly scope: CustomizationEnablementKind;
	}
	| {
		readonly source: 'plugin';
		readonly plugin: {
			readonly id: string;
			readonly name: string;
			readonly uri: string;
			readonly clientId?: string;
			readonly enablement?: readonly CustomizationEnablement[];
		};
	};

export function getCustomizationEnablementDecision(customization: { readonly enablement?: readonly CustomizationEnablement[] }): CustomizationEnablement | undefined {
	return customization.enablement?.[0];
}

export function isCustomizationEnabled(customization: { readonly enablement?: readonly CustomizationEnablement[] }): boolean {
	return getCustomizationEnablementDecision(customization)?.enabled ?? DEFAULT_CUSTOMIZATION_ENABLED;
}

export function isSkillEligibleForUserInvocation(skill: SkillCustomization): boolean {
	return skill.enabled !== false && skill.disableUserInvocation !== true;
}

export interface ICustomizationScopeEnablement {
	readonly global: boolean;
	readonly workspace: boolean;
	readonly session: boolean;
}

export function getCustomizationScopeEnablement(customization: { readonly enablement?: readonly CustomizationEnablement[] }): ICustomizationScopeEnablement {
	const global = customization.enablement?.find(decision => decision.kind === CustomizationEnablementKind.Global)?.enabled ?? DEFAULT_CUSTOMIZATION_ENABLED;
	const workspace = customization.enablement?.find(decision => decision.kind === CustomizationEnablementKind.Workspace)?.enabled ?? global;
	return {
		global,
		workspace,
		session: isCustomizationEnabled(customization),
	};
}

export function getCustomizationDisabledReason(customization: { readonly enablement?: readonly CustomizationEnablement[] }, plugin?: { readonly id: string; readonly name: string; readonly uri: string; readonly clientId?: string; readonly enablement?: readonly CustomizationEnablement[] }): CustomizationDisabledReason | undefined {
	if (plugin && !isCustomizationEnabled(plugin)) {
		return {
			source: 'plugin',
			plugin: {
				id: plugin.id,
				name: plugin.name,
				uri: plugin.uri,
				...(plugin.clientId === undefined ? undefined : { clientId: plugin.clientId }),
				enablement: plugin.enablement,
			},
		};
	}
	const decision = getCustomizationEnablementDecision(customization);
	return decision?.enabled === false ? { source: 'scope', scope: decision.kind } : undefined;
}

function customizationEnablementOrder(kind: CustomizationEnablementKind): number {
	switch (kind) {
		case CustomizationEnablementKind.Session:
			return 0;
		case CustomizationEnablementKind.Workspace:
			return 1;
		case CustomizationEnablementKind.Global:
			return 2;
		default: {
			const exhaustiveKind: never = kind;
			return exhaustiveKind;
		}
	}
}

export function sortCustomizationEnablement(enablement: readonly CustomizationEnablement[]): CustomizationEnablement[] {
	return enablement
		.map((decision, index) => ({ decision, index }))
		.sort((a, b) => customizationEnablementOrder(a.decision.kind) - customizationEnablementOrder(b.decision.kind) || a.index - b.index)
		.map(({ decision }) => decision);
}

export function withCustomizationEnablement(current: readonly CustomizationEnablement[] | undefined, kind: CustomizationEnablementKind, entry: CustomizationEnablement | readonly CustomizationEnablement[] | undefined): CustomizationEnablement[] {
	const replacement: readonly CustomizationEnablement[] = entry === undefined
		? []
		: Array.isArray(entry)
			? entry
			: [entry];
	return sortCustomizationEnablement([
		...(current?.filter(decision => decision.kind !== kind) ?? []),
		...replacement,
	]);
}
