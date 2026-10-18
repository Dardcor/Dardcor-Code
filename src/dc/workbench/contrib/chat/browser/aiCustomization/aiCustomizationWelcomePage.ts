/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { AICustomizationManagementSection } from './aiCustomizationManagement.js';
import { CustomizationMigrationCategoryId } from './customizationMigrationCategories.js';
import { IAICustomizationWorkspaceService, IWelcomePageFeatures } from '../../common/aiCustomizationWorkspaceService.js';
import { PromptLaunchersAICustomizationWelcomePage } from './aiCustomizationWelcomePagePromptLaunchers.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';

const $ = DOM.$;

export interface ICustomizationMigrationCategorySummary {
	readonly id: CustomizationMigrationCategoryId;
	readonly label: string;
	readonly description: string;
	readonly actionLabel: string;
	readonly actionAriaLabel: string;
	readonly count: number;
}

export interface IWelcomePageCallbacks {
	selectSection(section: AICustomizationManagementSection): void;
	selectSectionWithMarketplace(section: AICustomizationManagementSection): void;
	closeEditor(): void;
	migrateCustomizations(categoryId: CustomizationMigrationCategoryId): void;
	prefillChat(query: string, options?: { isPartialQuery?: boolean; newChat?: boolean }): void;
}

export interface IAICustomizationWelcomePageImplementation extends IDisposable {
	readonly container: HTMLElement;
	rebuildCards(visibleSectionIds: ReadonlySet<AICustomizationManagementSection>): void;
	setHarnessLabel(label: string): void;
	setMigrationCategories(categories: readonly ICustomizationMigrationCategorySummary[]): void;
	focus(): void;
	reset?(): void;
}

export class AICustomizationWelcomePage extends Disposable {

	private readonly implementation: IAICustomizationWelcomePageImplementation;

	readonly container: HTMLElement;

	constructor(
		parent: HTMLElement,
		welcomePageFeatures: IWelcomePageFeatures | undefined,
		callbacks: IWelcomePageCallbacks,
		commandService: ICommandService,
		workspaceService: IAICustomizationWorkspaceService,
		hoverService: IHoverService,
		harnessLabel: string,
	) {
		super();

		this.container = DOM.append(parent, $('.welcome-page-host'));
		this.container.style.height = '100%';
		this.container.style.overflow = 'hidden';
		this.implementation = this._register(new PromptLaunchersAICustomizationWelcomePage(this.container, welcomePageFeatures, callbacks, commandService, workspaceService, hoverService, harnessLabel));
	}

	rebuildCards(visibleSectionIds: ReadonlySet<AICustomizationManagementSection>): void {
		this.implementation.rebuildCards(visibleSectionIds);
	}

	setHarnessLabel(label: string): void {
		this.implementation.setHarnessLabel(label);
	}

	setMigrationCategories(categories: readonly ICustomizationMigrationCategorySummary[]): void {
		this.implementation.setMigrationCategories(categories);
	}

	focus(): void {
		this.implementation.focus();
	}

	reset(): void {
		this.implementation.reset?.();
	}
}
