/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { findNodeAtLocation, Node, parse as parseJSONC, parseTree } from '../../../../../base/common/json.js';
import { ITextEditorSelection } from '../../../../../platform/editor/common/editor.js';
import { URI } from '../../../../../base/common/uri.js';
import { IPromptsService, PromptsStorage } from '../../common/promptSyntax/service/promptsService.js';
import { PromptsType } from '../../common/promptSyntax/promptTypes.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { formatHookCommandLabel } from '../../common/promptSyntax/hookSchema.js';
import { type IParsedHookCommand } from '../../../../../platform/agentPlugins/common/pluginParsers.js';
import { HOOK_METADATA, HookType } from '../../common/promptSyntax/hookTypes.js';
import { parseHooksFromFile, parseHooksIgnoringDisableAll } from '../../common/promptSyntax/hookCompatibility.js';
import * as nls from '../../../../../nls.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { OperatingSystem } from '../../../../../base/common/platform.js';

function offsetToPosition(content: string, offset: number): { line: number; column: number } {
	let line = 1;
	let column = 1;
	for (let i = 0; i < offset && i < content.length; i++) {
		if (content[i] === '\n') {
			line++;
			column = 1;
		} else {
			column++;
		}
	}
	return { line, column };
}

function findNthCommandNode(tree: Node, hookType: string, targetIndex: number, fieldName: string): Node | undefined {
	const hookTypeArray = findNodeAtLocation(tree, ['hooks', hookType]);
	if (!hookTypeArray || hookTypeArray.type !== 'array' || !hookTypeArray.children) {
		return undefined;
	}

	let currentIndex = 0;

	for (let i = 0; i < hookTypeArray.children.length; i++) {
		const item = hookTypeArray.children[i];
		if (item.type !== 'object') {
			continue;
		}

		const nestedHooksNode = findNodeAtLocation(tree, ['hooks', hookType, i, 'hooks']);
		if (nestedHooksNode && nestedHooksNode.type === 'array' && nestedHooksNode.children) {
			for (let j = 0; j < nestedHooksNode.children.length; j++) {
				if (currentIndex === targetIndex) {
					return findNodeAtLocation(tree, ['hooks', hookType, i, 'hooks', j, fieldName]);
				}
				currentIndex++;
			}
		} else {
			if (currentIndex === targetIndex) {
				return findNodeAtLocation(tree, ['hooks', hookType, i, fieldName]);
			}
			currentIndex++;
		}
	}

	return undefined;
}

export function findHookCommandSelection(content: string, hookType: string, index: number, fieldName: string): ITextEditorSelection | undefined {
	const tree = parseTree(content);
	if (!tree) {
		return undefined;
	}

	const node = findNthCommandNode(tree, hookType, index, fieldName);
	if (!node || node.type !== 'string') {
		return undefined;
	}

	const valueStart = node.offset + 1;
	const valueEnd = node.offset + node.length - 1;

	const start = offsetToPosition(content, valueStart);
	const end = offsetToPosition(content, valueEnd);

	return {
		startLineNumber: start.line,
		startColumn: start.column,
		endLineNumber: end.line,
		endColumn: end.column
	};
}

export function findHookCommandInYaml(content: string, commandText: string): ITextEditorSelection | undefined {
	const commandFieldKeys = ['command', 'windows', 'linux', 'osx', 'bash', 'powershell'];
	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trimStart();

		const matchedKey = commandFieldKeys.find(key =>
			trimmed.startsWith(`${key}:`) || trimmed.startsWith(`- ${key}:`)
		);
		if (!matchedKey) {
			continue;
		}

		const colonIdx = line.indexOf(':');
		const idx = line.indexOf(commandText, colonIdx + 1);
		if (idx !== -1) {
			const afterIdx = idx + commandText.length;
			const charAfter = afterIdx < line.length ? line.charCodeAt(afterIdx) : -1;
			if (charAfter === -1 || charAfter === 34 || charAfter === 39 || charAfter === 32 || charAfter === 9 ) {
				return {
					startLineNumber: i + 1,
					startColumn: idx + 1,
					endLineNumber: i + 1,
					endColumn: idx + 1 + commandText.length
				};
			}
		}
	}

	return undefined;
}

export interface IParsedHook {
	hookType: HookType;
	hookTypeLabel: string;
	command: IParsedHookCommand;
	commandLabel: string;
	fileUri: URI;
	filePath: string;
	index: number;
	originalHookTypeId: string;
	disabled?: boolean;
	agentName?: string;
}

export interface IParseAllHookFilesOptions {
	additionalDisabledFileUris?: readonly URI[];
	includeAgentHooks?: boolean;
	preferredStorage?: PromptsStorage;
}

export async function parseAllHookFiles(
	promptsService: IPromptsService,
	fileService: IFileService,
	labelService: ILabelService,
	workspaceRootUri: URI | undefined,
	userHome: string,
	os: OperatingSystem,
	token: CancellationToken,
	options?: IParseAllHookFilesOptions
): Promise<IParsedHook[]> {
	const hookFiles = options?.preferredStorage
		? await promptsService.listPromptFilesForStorage(PromptsType.hook, options.preferredStorage, token)
		: await promptsService.listPromptFiles(PromptsType.hook, token);
	const parsedHooks: IParsedHook[] = [];

	for (const hookFile of hookFiles) {
		try {
			const content = await fileService.readFile(hookFile.uri);
			const json = parseJSONC(content.value.toString());

			const { hooks } = parseHooksFromFile(hookFile.uri, json, workspaceRootUri, userHome);

			for (const [hookType, { hooks: commands, originalId }] of hooks) {
				const hookTypeMeta = HOOK_METADATA[hookType];
				if (!hookTypeMeta) {
					continue;
				}

				for (let i = 0; i < commands.length; i++) {
					const command = commands[i];
					const commandLabel = formatHookCommandLabel(command, os) || nls.localize('commands.hook.emptyCommand', '(empty command)');
					parsedHooks.push({
						hookType,
						hookTypeLabel: hookTypeMeta.label,
						command,
						commandLabel,
						fileUri: hookFile.uri,
						filePath: labelService.getUriLabel(hookFile.uri, { relative: true }),
						index: i,
						originalHookTypeId: originalId
					});
				}
			}
		} catch (error) {
			console.error('Failed to read or parse hook file', hookFile.uri.toString(), error);
		}
	}

	if (options?.additionalDisabledFileUris) {
		for (const uri of options.additionalDisabledFileUris) {
			try {
				const content = await fileService.readFile(uri);
				const json = parseJSONC(content.value.toString());

				const { hooks } = parseHooksIgnoringDisableAll(uri, json, workspaceRootUri, userHome);

				for (const [hookType, { hooks: commands, originalId }] of hooks) {
					const hookTypeMeta = HOOK_METADATA[hookType];
					if (!hookTypeMeta) {
						continue;
					}

					for (let i = 0; i < commands.length; i++) {
						const command = commands[i];
						const commandLabel = formatHookCommandLabel(command, os) || nls.localize('commands.hook.emptyCommand', '(empty command)');
						parsedHooks.push({
							hookType,
							hookTypeLabel: hookTypeMeta.label,
							command,
							commandLabel,
							fileUri: uri,
							filePath: labelService.getUriLabel(uri, { relative: true }),
							index: i,
							originalHookTypeId: originalId,
							disabled: true
						});
					}
				}
			} catch (error) {
				console.error('Failed to read or parse disabled hook file', uri.toString(), error);
			}
		}
	}

	if (options?.includeAgentHooks) {
		const agents = await promptsService.getCustomAgents(token);
		for (const agent of agents) {
			if (!agent.hooks || !agent.enabled || options.preferredStorage && agent.source.storage !== options.preferredStorage) {
				continue;
			}
			for (const hookTypeValue of Object.values(HookType)) {
				const commands = agent.hooks[hookTypeValue];
				if (!commands || commands.length === 0) {
					continue;
				}
				const hookTypeMeta = HOOK_METADATA[hookTypeValue];
				if (!hookTypeMeta) {
					continue;
				}
				for (let i = 0; i < commands.length; i++) {
					const command = commands[i];
					const commandLabel = formatHookCommandLabel(command, os) || nls.localize('commands.hook.emptyCommand', '(empty command)');
					parsedHooks.push({
						hookType: hookTypeValue,
						hookTypeLabel: hookTypeMeta.label,
						command,
						commandLabel,
						fileUri: agent.uri,
						filePath: labelService.getUriLabel(agent.uri, { relative: true }),
						index: i,
						originalHookTypeId: hookTypeValue,
						agentName: agent.name,
					});
				}
			}
		}
	}

	return parsedHooks;
}
