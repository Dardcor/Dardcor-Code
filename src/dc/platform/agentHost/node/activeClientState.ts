/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equals } from '../../../base/common/objects.js';
import type { ToolDefinition } from '../common/state/protocol/state.js';

export interface IActiveClientStructuralSnapshot {
	readonly tools: readonly ToolDefinition[];
}

export function structuralToolsEqual(
	a: readonly ToolDefinition[] | undefined,
	b: readonly ToolDefinition[] | undefined,
): boolean {
	const aa = a ?? [];
	const bb = b ?? [];
	if (aa.length !== bb.length) {
		return false;
	}
	const byName = new Map<string, ToolDefinition>();
	for (const t of aa) {
		byName.set(t.name, t);
	}
	for (const t of bb) {
		const prev = byName.get(t.name);
		if (!prev) {
			return false;
		}
		if (prev.description !== t.description) {
			return false;
		}
		if (!equals(prev.inputSchema, t.inputSchema)) {
			return false;
		}
	}
	return true;
}

export class ActiveClientToolSet {
	private readonly _byClient = new Map<string, readonly ToolDefinition[]>();

	get size(): number {
		return this._byClient.size;
	}

	has(clientId: string): boolean {
		return this._byClient.has(clientId);
	}

	clientIds(): IterableIterator<string> {
		return this._byClient.keys();
	}

	get(clientId: string): readonly ToolDefinition[] {
		return this._byClient.get(clientId) ?? [];
	}

	set(clientId: string, tools: readonly ToolDefinition[]): void {
		this._byClient.set(clientId, tools);
	}

	delete(clientId: string): boolean {
		return this._byClient.delete(clientId);
	}

	merged(): readonly ToolDefinition[] {
		const seen = new Set<string>();
		const result: ToolDefinition[] = [];
		for (const tools of this._byClient.values()) {
			for (const tool of tools) {
				if (seen.has(tool.name)) {
					continue;
				}
				seen.add(tool.name);
				result.push(tool);
			}
		}
		return result;
	}

	ownerOf(toolName: string, preferredClientId?: string): string | undefined {
		if (preferredClientId && this.get(preferredClientId).some(tool => tool.name === toolName)) {
			return preferredClientId;
		}
		for (const [clientId, tools] of this._byClient) {
			if (tools.some(tool => tool.name === toolName)) {
				return clientId;
			}
		}
		return undefined;
	}

	structuralEquals(applied: readonly ToolDefinition[] | undefined): boolean {
		return structuralToolsEqual(this.merged(), applied);
	}
}

export class ActiveClientState {
	private _clientId: string | undefined = undefined;
	private _tools: readonly ToolDefinition[] = [];

	get clientId(): string | undefined {
		return this._clientId;
	}

	get tools(): readonly ToolDefinition[] {
		return this._tools;
	}

	update(clientId: string | undefined, tools: readonly ToolDefinition[]): void {
		this._clientId = clientId;
		this._tools = tools;
	}

	structuralEquals(applied: IActiveClientStructuralSnapshot): boolean {
		return structuralToolsEqual(this._tools, applied.tools);
	}
}
