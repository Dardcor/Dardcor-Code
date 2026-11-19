/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IOnboardingScenario, OnboardingOutcome } from './onboardingScenario.js';

export const IOnboardingScenarioService = createDecorator<IOnboardingScenarioService>('onboardingScenarioService');

export const ONBOARDING_ENABLED_CONFIG = 'onboarding.enabled';

export const ONBOARDING_DEVELOPER_MODE_CONFIG = 'onboarding.developerMode';

export const ONBOARDING_DEVELOPER_MODE_VARIATIONS_CONFIG = 'onboarding.developerModeVariations';

export type OnboardingDeveloperMode = { readonly [scenarioId: string]: boolean };

export type OnboardingDeveloperModeVariations = { readonly [scenarioId: string]: string };

export function isOnboardingDeveloperModeEnabled(configurationService: IConfigurationService, scenarioId: string): boolean {
	const value = configurationService.getValue<OnboardingDeveloperMode | undefined>(ONBOARDING_DEVELOPER_MODE_CONFIG);
	return typeof value === 'object' && value !== null && value[scenarioId] === true;
}

export function getOnboardingDeveloperModeVariation(configurationService: IConfigurationService, scenarioId: string): string | undefined {
	if (!isOnboardingDeveloperModeEnabled(configurationService, scenarioId)) {
		return undefined;
	}
	const value = configurationService.getValue<OnboardingDeveloperModeVariations | undefined>(ONBOARDING_DEVELOPER_MODE_VARIATIONS_CONFIG);
	const variation = typeof value === 'object' && value !== null ? value[scenarioId] : undefined;
	return typeof variation === 'string' && variation.length > 0 ? variation : undefined;
}

export interface IOnboardingScenarioService {
	readonly _serviceBrand: undefined;

	start(): void;

	runScenario(id: string): Promise<OnboardingOutcome>;

	getScenarios(): readonly IOnboardingScenario[];

	hasBeenShown(id: string): boolean;

	reset(id: string): void;

	resetAll(): void;
}
