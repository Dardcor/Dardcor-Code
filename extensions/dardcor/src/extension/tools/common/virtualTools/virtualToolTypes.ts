/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageModelToolInformation, LanguageModelToolResult } from 'vscode';
import { createServiceIdentifier } from '../../../../util/common/services';
import { CancellationToken } from '../../../../util/dardcor/base/common/cancellation';
import { IObservable } from '../../../../util/dardcor/base/common/observableInternal';
import { VirtualTool } from './virtualTool';

export interface IToolGrouping {
	tools: readonly LanguageModelToolInformation[];

	didCall(localTurnNumber: number, toolCallName: string): LanguageModelToolResult | undefined;

	didTakeTurn(): void;

	didInvalidateCache(): void;

	getContainerFor(toolName: string): VirtualTool | undefined;

	ensureExpanded(toolName: string): void;

	compute(query: string, token: CancellationToken): Promise<LanguageModelToolInformation[]>;

	computeAll(query: string, token: CancellationToken): Promise<(LanguageModelToolInformation | VirtualTool)[]>;
}

export interface IToolGroupingService {
	_serviceBrand: undefined;
	threshold: IObservable<number>;
	create(sessionId: string, tools: readonly LanguageModelToolInformation[]): IToolGrouping;
}

export const IToolGroupingService = createServiceIdentifier<IToolGroupingService>('IToolGroupingService');

export interface IToolGroupingCache {
	_serviceBrand: undefined;

	clear(): Promise<void>;

	flush(): Promise<void>;

	getDescription(tools: LanguageModelToolInformation[]): Promise<ISummarizedToolCategoryUpdatable>;
}

export const IToolGroupingCache = createServiceIdentifier<IToolGroupingCache>('IToolGroupingCache');


export interface IToolCategorization {
	addGroups(query: string, root: VirtualTool, tools: LanguageModelToolInformation[], token: CancellationToken): Promise<void>;

	recomputeEmbeddingRankings(query: string, root: VirtualTool, token: CancellationToken): Promise<void>;
}

export interface ISummarizedToolCategory {
	summary: string;
	name: string;
	tools: LanguageModelToolInformation[];
}

export interface ISummarizedToolCategoryUpdatable {
	category: ISummarizedToolCategory | undefined;
	tools: LanguageModelToolInformation[];
	update(up: ISummarizedToolCategory): void;
}

export class SummarizerError extends Error { }
