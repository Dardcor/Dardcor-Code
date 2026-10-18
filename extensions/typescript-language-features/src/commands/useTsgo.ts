/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { readUnifiedConfig, unifiedConfigSection } from '../utils/configuration';
import { Command } from './commandManager';

export const tsNativeExtensionOldId = 'typescriptteam.native-preview';
export const tsNativeExtensionIds = ['typescriptteam.vscode-typescript', tsNativeExtensionOldId] as const;

export function getTsNativeExtension(): vscode.Extension<unknown> | undefined {
	for (const extensionId of tsNativeExtensionIds) {
		const extension = vscode.extensions.getExtension(extensionId);
		if (extension) {
			return extension;
		}
	}

	return undefined;
}

export class EnableTsgoCommand implements Command {
	public readonly id = 'typescript.experimental.enableTsgo';

	public async execute(): Promise<void> {
		await updateTsgoSetting(true);
	}
}

export class DisableTsgoCommand implements Command {
	public readonly id = 'typescript.experimental.disableTsgo';

	public async execute(): Promise<void> {
		await updateTsgoSetting(false);
	}
}

async function updateTsgoSetting(enable: boolean): Promise<void> {
	const tsgoExtension = getTsNativeExtension();
	if (!tsgoExtension) {
		const selection = await vscode.window.showErrorMessage(
			vscode.l10n.t('The TypeScript Go extension is not installed.'),
			{
				title: vscode.l10n.t('Open on GitHub'),
				isCloseAffordance: true,
			}
		);

		if (selection) {
			await vscode.env.openExternal(vscode.Uri.parse('https://github.com/microsoft/typescript-go'));
		}
	}

	const currentValue = readUnifiedConfig<boolean>('experimental.useTsgo', false, { fallbackSection: 'typescript' });
	if (currentValue === enable) {
		return;
	}

	let target = vscode.ConfigurationTarget.Global;
	const unifiedConfig = vscode.workspace.getConfiguration(unifiedConfigSection);
	const inspect = unifiedConfig.inspect<boolean>('experimental.useTsgo');
	const legacyInspect = vscode.workspace.getConfiguration('typescript').inspect<boolean>('experimental.useTsgo');
	if (inspect?.workspaceValue !== undefined || legacyInspect?.workspaceValue !== undefined) {
		target = vscode.ConfigurationTarget.Workspace;
	} else if (inspect?.workspaceFolderValue !== undefined || legacyInspect?.workspaceFolderValue !== undefined) {
		target = vscode.ConfigurationTarget.WorkspaceFolder;
	} else {
		const tsgoConfig = vscode.workspace.getConfiguration('typescript-go');
		const tsgoInspect = tsgoConfig.inspect<string>('executablePath');

		if (tsgoInspect?.workspaceValue !== undefined) {
			target = vscode.ConfigurationTarget.Workspace;
		} else if (tsgoInspect?.workspaceFolderValue !== undefined) {
			target = vscode.ConfigurationTarget.WorkspaceFolder;
		}
	}

	await unifiedConfig.update('experimental.useTsgo', enable, target);
}
