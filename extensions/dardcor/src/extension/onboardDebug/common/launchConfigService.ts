/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { URI } from '../../../util/dardcor/base/common/uri';

export const needsWorkspaceFolderForTaskError = () => l10n.t`The model asked to run a build task, which requires a workspace folder. Please open a folder and retry.`;

export interface ILaunchConfigService {
	_serviceBrand: undefined;

	add(workspaceFolder: URI | undefined, config: ILaunchJSON): Promise<void>;

	show(workspaceFolder: URI, showConfigName?: string): Promise<void>;

	launch(config: ILaunchJSON | vscode.DebugConfiguration): Promise<void>;

	resolveConfigurationInputs(launchJson: ILaunchJSON, defaults?: Map<string, string>, interactor?: ICommandInteractor): Promise<{ config: vscode.DebugConfiguration; inputs: Map<string, string> } | undefined>;
}

export const ILaunchConfigService = createServiceIdentifier<ILaunchConfigService>('ILaunchConfigService');

export interface ILaunchJSON {
	configurations: vscode.DebugConfiguration[];
	inputs?: {
		type: string;
		id: string;
		description: string;
		options: string[];
	}[];
}

export interface ITasksJSON {
	tasks: vscode.TaskDefinition[];
}

export interface ICommandInteractor {
	isGenerating(): void;
	prompt(text: string, defaultValue?: string): Promise<string | undefined>;
	ensureTask(workspaceFolder: URI | undefined, definition: vscode.TaskDefinition): Promise<boolean>;
}
