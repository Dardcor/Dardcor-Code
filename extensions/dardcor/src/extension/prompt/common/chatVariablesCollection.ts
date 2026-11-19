/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { sessionResourceToId } from '../../../platform/chat/common/chatDebugFileLoggerService';
import { URI } from '../../../util/dardcor/base/common/uri';
import { basename } from '../../../util/dardcor/base/common/resources';

export interface PromptVariable {
	readonly reference: vscode.ChatPromptReference;
	readonly originalName: string;
	readonly uniqueName: string;
	readonly value: string | vscode.Uri | vscode.Location | unknown;
	readonly range?: [start: number, end: number];
	readonly isMarkedReadonly: boolean | undefined;
}

export class ChatVariablesCollection {
	private _variables: PromptVariable[] | null = null;

	static mergeAndDedup(...collections: ChatVariablesCollection[]): ChatVariablesCollection {
		const allReferences: vscode.ChatPromptReference[] = [];
		const seen = new Set<string>();
		for (const collection of collections) {
			for (const variable of collection) {
				const ref = variable.reference;

				let key: string;
				try {
					key = JSON.stringify(ref.value);
				} catch {
					key = ref.id + String(ref.value);
				}

				if (!seen.has(key)) {
					seen.add(key);
					allReferences.push(ref);
				}
			}
		}

		return new ChatVariablesCollection(allReferences);
	}

	static merge(...collections: ChatVariablesCollection[]): ChatVariablesCollection {
		const allReferences: vscode.ChatPromptReference[] = [];
		for (const collection of collections) {
			for (const variable of collection) {
				allReferences.push(variable.reference);
			}
		}
		return new ChatVariablesCollection(allReferences);
	}

	constructor(
		private readonly _source: readonly vscode.ChatPromptReference[] = []
	) { }

	private _getVariables(): PromptVariable[] {
		if (!this._variables) {
			this._variables = [];
			for (let i = 0; i < this._source.length; i++) {
				const variable = this._source[i];
				if (variable.value) {
					const originalName = variable.name;
					const uniqueName = this.uniqueFileName(originalName, this._source.slice(0, i));
					this._variables.push({ reference: variable, originalName, uniqueName, value: variable.value, range: variable.range, isMarkedReadonly: false });
				}
			}
		}
		return this._variables;
	}

	public get references(): readonly vscode.ChatPromptReference[] {
		return this._getVariables().map(v => v.reference);
	}

	public reverse() {
		const sourceCopy = this._source.slice(0);
		sourceCopy.reverse();
		return new ChatVariablesCollection(sourceCopy);
	}

	public find(predicate: (v: PromptVariable) => boolean): PromptVariable | undefined {
		return this._getVariables().find(predicate);
	}

	public filter(predicate: (v: PromptVariable) => boolean): ChatVariablesCollection {
		const resultingReferences: vscode.ChatPromptReference[] = [];
		for (const variable of this._getVariables()) {
			if (predicate(variable)) {
				resultingReferences.push(variable.reference);
			}
		}
		return new ChatVariablesCollection(resultingReferences);
	}

	public *[Symbol.iterator](): IterableIterator<PromptVariable> {
		yield* this._getVariables();
	}

	public substituteVariablesWithReferences(userQuery: string): string {
		return userQuery;
	}

	public hasVariables(): boolean {
		return this._getVariables().length > 0;
	}

	private uniqueFileName(name: string, variables: vscode.ChatPromptReference[]): string {
		const count = variables.filter(v => v.name === name).length;
		return count === 0 ? name : `${name}-${count}`;
	}

}

export function isPromptFile(reference: vscode.ChatPromptReference): reference is vscode.ChatPromptReference & { value: vscode.Uri } {
	return reference.id.startsWith(PromptFileIdPrefix);
}

export const PromptFileIdPrefix = 'vscode.prompt.file';

export function isInstructionFile(reference: vscode.ChatPromptReference): reference is vscode.ChatPromptReference & { value: vscode.Uri } {
	return reference.id.startsWith(InstructionFileIdPrefix);
}

export const InstructionFileIdPrefix = 'vscode.instructions.file';

export function isCustomizationsIndex(reference: vscode.ChatPromptReference): reference is vscode.ChatPromptReference & { value: string } {
	return reference.id === CustomizationsIndexId;
}

export function toInstructionFileReference(uri: URI, isRoot: boolean, originLabel: string | undefined): vscode.ChatPromptReference {
	const idSuffix = isRoot ? 'root' : 'reference';
	return {
		id: `${InstructionFileIdPrefix}.${idSuffix}__${uri.toString()}`,
		name: `prompt:${basename(uri)}`,
		value: uri,
		modelDescription: originLabel ?? 'Prompt instructions file',
	};
}

export const CustomizationsIndexId = 'vscode.customizations.index';


export function toCustomizationsIndexReference(content: string): vscode.ChatPromptReference {
	return {
		id: CustomizationsIndexId,
		name: 'prompt:customizationsIndex',
		value: content,
		modelDescription: 'Chat customizations index',
	};
}

export const SessionReferenceSchemes: ReadonlySet<string> = new Set(['vscode-chat-session', 'claude-code']);

export function isSessionReferenceScheme(scheme: string): boolean {
	return SessionReferenceSchemes.has(scheme);
}

export function isSessionReference(variable: PromptVariable): variable is PromptVariable & { value: vscode.Uri } {
	return URI.isUri(variable.value) && isSessionReferenceScheme(variable.value.scheme);
}

export function sessionReferenceAttachmentAttrs(variable: PromptVariable & { value: vscode.Uri }): Record<string, string> {
	const attrs: Record<string, string> = {};
	if (variable.uniqueName) {
		attrs.id = `${variable.uniqueName} (${sessionResourceToId(variable.value)})`;
	}
	attrs.filePath = variable.value.toString();
	return attrs;
}

export function extractDebugTargetSessionIds(references: readonly vscode.ChatPromptReference[]): readonly string[] | undefined {
	const sessionRefs = references.filter(ref => URI.isUri(ref.value) && isSessionReferenceScheme(ref.value.scheme));
	return sessionRefs.length > 0 ? sessionRefs.map(ref => sessionResourceToId(ref.value as URI)) : undefined;
}

export interface PromptFileSlashCommandId {
	readonly name: string;
	readonly id: string;
}

export function getPromptFileSlashCommandId(variable: PromptVariable): PromptFileSlashCommandId {
	const name = variable.reference.name;
	const uri = variable.value;
	const pathSegments = URI.isUri(uri) ? uri.path.split('/').filter(Boolean) : [];
	const lastSegment = pathSegments[pathSegments.length - 1];
	const isSkillFile = lastSegment?.toLowerCase() === 'skill.md';
	let id: string;
	if (isSkillFile && pathSegments.length >= 2) {
		id = pathSegments[pathSegments.length - 2];
	} else if (lastSegment?.endsWith('.prompt.md')) {
		id = lastSegment.slice(0, -'.prompt.md'.length);
	} else {
		id = name;
	}
	return { name, id };
}

export interface ParsedSlashCommand {
	readonly promptFile: PromptFileSlashCommandId;
	readonly variable: PromptVariable;
	readonly command: string;
	readonly args: string;
}

export function parseSlashCommand(query: string, chatVariables: ChatVariablesCollection): ParsedSlashCommand | undefined {
	const slashCommandMatch = query.match(/^\s*\/(?<command>\S+)(?:\s+(?<args>.*))?$/s);
	const slashCommand = slashCommandMatch?.groups?.command;
	if (!slashCommand) {
		return undefined;
	}
	const args = slashCommandMatch?.groups?.args?.trim() ?? '';
	for (const variable of chatVariables) {
		if (!isPromptFile(variable.reference)) {
			continue;
		}
		const promptFile = getPromptFileSlashCommandId(variable);
		if (promptFile.id === slashCommand) {
			return { promptFile, variable, command: slashCommand, args };
		}
	}
	return undefined;
}
