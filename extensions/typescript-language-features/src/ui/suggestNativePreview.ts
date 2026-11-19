/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getTsNativeExtension, tsNativeExtensionOldId } from '../commands/useTsgo';
import { ExperimentationService } from '../experimentationService';

const suggestNativePreviewStorageKey = 'typescript.suggestNativePreview.dismissed';

export async function suggestNativePreview(
	context: vscode.ExtensionContext,
	experimentationService: ExperimentationService,
): Promise<void> {
	if (context.globalState.get<boolean>(suggestNativePreviewStorageKey)) {
		return;
	}

	if (!vscode.window.state.active) {
		return;
	}

	if (!vscode.extensions.getExtension('ms-vscode.vscode-typescript-next')) {
		return;
	}

	if (getTsNativeExtension()) {
		await context.globalState.update(suggestNativePreviewStorageKey, true);
		return;
	}

	const inExperiment = await experimentationService.getTreatmentVariable('suggestNativePreview', false);
	if (!inExperiment) {
		return;
	}

	const install: vscode.MessageItem = { title: vscode.l10n.t("Install") };
	const learnMore: vscode.MessageItem = { title: vscode.l10n.t("Learn More") };
	const dismiss: vscode.MessageItem = { title: vscode.l10n.t("Don't Show Again") };

	const selection = await vscode.window.showInformationMessage(
		vscode.l10n.t("Try TypeScript 7 Native Preview for significantly faster type checking and language features."),
		{},
		install,
		learnMore,
		dismiss,
	);
	await context.globalState.update(suggestNativePreviewStorageKey, true);

	if (selection === install) {
		await vscode.commands.executeCommand('workbench.extensions.installExtension', tsNativeExtensionOldId);
	} else if (selection === learnMore) {
		await vscode.env.openExternal(vscode.Uri.parse('https://www.dardcor-code.web.id/docs/languages/typescript/preview'));
	}
}
