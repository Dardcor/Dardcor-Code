/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as l10n from '@vscode/l10n';
import type { Command } from 'vscode';
import { IWorkbenchService } from '../../../../platform/workbench/common/workbenchService';
import { extractCodeBlocks } from '../../../../util/common/markdown';

export interface VSCodeParticipantMetadata {
	commandToRun?: Command;
}

export async function parseSettingsAndCommands(workbenchService: IWorkbenchService, codeBlock: string): Promise<VSCodeParticipantMetadata[]> {
	const parsedCodeBlock = extractCodeBlocks(codeBlock);

	for (const block of parsedCodeBlock) {
		if (block.language !== 'json' && block.language !== '') {
			return [];
		}

		let parsed: ParsedItem[] = [];
		try {
			const removeTrailingCommas = block.code.replace(/,\s*([\]}])/g, '$1');
			parsed = JSON.parse(removeTrailingCommas);
		} catch (error) {
			return [];
		}

		if (!parsed.length) {
			return [];
		}
		const parsedMetadata: VSCodeParticipantMetadata[] = [];
		const hasSettings = parsed.some(item => item.type === 'setting');
		const hasCommands = parsed.some(item => item.type === 'command');

		if (hasSettings) {
			const allSettings = await workbenchService.getAllSettings();
			parsed = parsed.filter(item => {
				if (item.details) {
					return Object.keys(allSettings).includes(item.details.key);
				}
				return true;
			});

			const settingsQuery = parsed.reduce((acc: string, item: ParsedItem) => {
				if (item.details) {
					acc += `@id:${item.details.key} `;
				}
				return acc;
			}, '');

			parsedMetadata.push({
				commandToRun: {
					command: 'workbench.action.openSettings',
					arguments: [settingsQuery],
					title: l10n.t("Show in Settings Editor"),
				}
			});

			return parsedMetadata;
		}

		if (hasCommands) {
			const item = parsed[0];
			if (item.details?.key === 'workbench.extensions.search' || item.details?.key === 'workbench.extensions.installExtension') {
				const args = (Array.isArray(item.details.value) ? item.details.value : [item.details.value]).filter(
					(arg): arg is string => typeof arg === 'string'
				);

				if (args.length === 1) {
					const KNOWN_QUERIES = [
						'featured',
						'popular',
						'recentlyPublished',
						'recommended',
						'updates',
						'builtin',
						'enabled',
						'disabled',
						'installed',
						'workspaceUnsupported',
					];
					if (args[0].includes(':') && !args[0].startsWith('@')) {
						args[0] = `@${args[0]}`;
					}
					else if (KNOWN_QUERIES.includes(args[0])) {
						args[0] = `@${args[0]}`;
					}
				}

				parsedMetadata.push({
					commandToRun: {
						command: 'workbench.extensions.search',
						arguments: args,
						title: l10n.t("Search Extension Marketplace"),
					}
				});
				return parsedMetadata;
			}
			else {
				const allCommandsNoFilter = (await workbenchService.getAllCommands(false));
				const commandItem = allCommandsNoFilter.find(commandItem => commandItem.command === item.details?.key);
				if (!commandItem) {
					parsedMetadata.push({
						commandToRun: {
							command: 'workbench.action.quickOpen',
							arguments: [`>`],
							title: l10n.t("Open Command Palette"),
						}
					});
					return parsedMetadata;
				}
				parsedMetadata.push({
					commandToRun: {
						command: 'workbench.action.quickOpen',
						arguments: [`>${commandItem.label ?? ''}`],
						title: parsedMetadata.length > 1 ? l10n.t('Show "{0}"', commandItem.label ?? '') : l10n.t("Show in Command Palette"),
					}
				});
				return parsedMetadata;
			}
		}
	}
	return [];

}

type ParsedItem = {
	type: 'command' | 'setting';
	details: {
		key: string;
		value?: string;
	};
};
