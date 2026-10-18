/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputButton, IQuickTreeItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { ConfirmedReason } from '../chatService/chatService.js';
import { IToolData, ToolDataSource } from './languageModelToolsService.js';

export async function computeCombinationKey(toolId: string, parameters: unknown): Promise<string> {
	const input = toolId + ':' + JSON.stringify(parameters);
	const encoded = new TextEncoder().encode(input);
	const buffer = await crypto.subtle.digest('SHA-256', encoded);
	const hashHex = Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
	return toolId + ':combination:' + hashHex;
}

export interface ILanguageModelToolConfirmationActions {
	label: string;
	detail?: string;
	divider?: boolean;
	scope?: 'session' | 'workspace' | 'profile';
	select(): Promise<boolean>;
}

export interface ILanguageModelToolConfirmationRef {
	toolId: string;
	source: ToolDataSource;
	parameters: unknown;
	chatSessionResource?: URI;
	workingDirectory?: URI;
	combination?: {
		label: string;
		key: string;
		arguments?: string;
	};
}

export interface ILanguageModelToolConfirmationActionProducer {
	getPreConfirmAction(ref: ILanguageModelToolConfirmationRef): ConfirmedReason | undefined;
	getPostConfirmAction(ref: ILanguageModelToolConfirmationRef): ConfirmedReason | undefined;

	getPreConfirmActions(ref: ILanguageModelToolConfirmationRef): ILanguageModelToolConfirmationActions[];
	getPostConfirmActions(ref: ILanguageModelToolConfirmationRef): ILanguageModelToolConfirmationActions[];
}

export interface ILanguageModelToolConfirmationContributionQuickTreeItem extends IQuickTreeItem {
	onDidTriggerItemButton?(button: IQuickInputButton): void;
	onDidChangeChecked?(checked: boolean): void;
	onDidOpen?(): void | Promise<void>;
}

export type ILanguageModelToolConfirmationContribution = Partial<ILanguageModelToolConfirmationActionProducer> & {
	getManageActions?(): ILanguageModelToolConfirmationContributionQuickTreeItem[];

	canUseDefaultApprovals?: boolean;

	reset?(): void;
};

export interface ILanguageModelToolsConfirmationService extends ILanguageModelToolConfirmationActionProducer {
	readonly _serviceBrand: undefined;

	manageConfirmationPreferences(tools: readonly IToolData[], options?: { defaultScope?: 'workspace' | 'profile' | 'session'; focusToolId?: string }): void;

	registerConfirmationContribution(toolName: string, contribution: ILanguageModelToolConfirmationContribution): IDisposable;

	toolCanManageConfirmation(tool: IToolData): boolean;

	resetToolAutoConfirmation(): void;
}

export const ILanguageModelToolsConfirmationService = createDecorator<ILanguageModelToolsConfirmationService>('ILanguageModelToolsConfirmationService');
