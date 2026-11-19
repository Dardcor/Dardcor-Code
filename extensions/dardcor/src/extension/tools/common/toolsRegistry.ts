/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { IChatEndpoint } from '../../../platform/networking/common/networking';
import { IDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { ObservableMap } from '../../../util/dardcor/base/common/observable';
import { URI } from '../../../util/dardcor/base/common/uri';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { ToolName } from './toolNames';

export interface IEditFilterData {
	title: string;
	message: string;
}

export enum AgentToolMode {
	PartialContext,

	FullContext,
}

export interface IAgentToolExtension<T> {
	filterEdits?(resource: URI): Promise<IEditFilterData | undefined>;

	provideInput?(promptContext: IBuildPromptContext): Promise<T | undefined>;

	resolveInput?(input: T, promptContext: IBuildPromptContext, mode: AgentToolMode): Promise<T>;

	alternativeDefinition?(tool: vscode.LanguageModelToolInformation, endpoint?: IChatEndpoint): vscode.LanguageModelToolInformation;
}

export interface IAgentTool<T> extends IAgentToolExtension<T> {
	invoke?: vscode.LanguageModelTool<T>['invoke'];
	prepareInvocation?: vscode.LanguageModelTool<T>['prepareInvocation'];
}

export interface IAgentModelSpecificTool<T> extends IAgentTool<T> {
	overridesTool?: ToolName;
}

export function isVscodeLanguageModelTool(tool: IAgentTool<unknown>): tool is vscode.LanguageModelTool<unknown> {
	return typeof tool.invoke === 'function';
}

export interface IAgentToolCtor {
	readonly toolName: ToolName;
	readonly nonDeferred?: boolean;
	new(...args: never[]): IAgentTool<unknown>;
}

export interface IModelSpecificToolCtor {
	new(...args: never[]): IAgentModelSpecificTool<unknown>;
}

export interface IAgentToolExtensionCtor extends IModelSpecificToolCtor {
	readonly toolName: ToolName;
	new(...args: never[]): IAgentToolExtension<unknown>;
}

export const ToolRegistry = new class {
	private _tools: Array<IAgentToolCtor> = [];
	private _toolExtensions: Array<IAgentToolExtensionCtor> = [];
	private _modelSpecificTools = new ObservableMap<string, { definition: vscode.LanguageModelToolDefinition; tool: IModelSpecificToolCtor }>();
	private _nonDeferredToolNames = new Set<string>();

	public get modelSpecificTools() {
		return this._modelSpecificTools.observable.map(v => [...v.values()]);
	}

	public registerTool(tool: IAgentToolCtor) {
		this._tools.push(tool);
		if (tool.nonDeferred) {
			this._nonDeferredToolNames.add(tool.toolName);
		}
	}

	public getTools(): readonly IAgentToolCtor[] {
		return this._tools;
	}

	public get nonDeferredToolNames(): ReadonlySet<string> {
		return this._nonDeferredToolNames;
	}

	public registerToolExtension(tool: IAgentToolExtensionCtor) {
		this._toolExtensions.push(tool);
	}

	public registerModelSpecificTool(definition: vscode.LanguageModelToolDefinition, tool: IModelSpecificToolCtor): IDisposable {
		if (this._modelSpecificTools.has(definition.name)) {
			throw new Error(`Model specific tool for ${definition.name} is already registered`);
		}

		this._modelSpecificTools.set(definition.name, { definition, tool });

		return {
			dispose: () => {
				this._modelSpecificTools.delete(definition.name);
			}
		};
	}

	public getToolExtensions(): readonly IAgentToolExtensionCtor[] {
		return this._toolExtensions;
	}
}();

export function modelSpecificToolApplies(tool: vscode.LanguageModelToolDefinition, endpoint: IChatEndpoint) {
	if (!tool.models) {
		return true;
	}

	return tool.models.some(m => {
		if (m.id !== undefined && m.id === endpoint.model) {
			return true;
		}
		if (m.version !== undefined && m.version === endpoint.version) {
			return true;
		}
		if (m.family !== undefined && m.family === endpoint.family) {
			return true;
		}

		if (m.vendor !== undefined && m.vendor === endpoint.version) {
			return true;
		}
	});
}
