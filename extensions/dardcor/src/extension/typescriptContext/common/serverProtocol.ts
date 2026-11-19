/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type tt from 'typescript/lib/tsserverlibrary';

export type DocumentUri = string;
export type FilePath = string;

export enum CacheScopeKind {
	File = 'file',
	WithinRange = 'withinRange',
	OutsideRange = 'outsideRange',
	NeighborFiles = 'neighborFiles'
}

export type FileCacheScope = {
	kind: CacheScopeKind.File;
};
export type NeighborFilesCacheScope = {
	kind: CacheScopeKind.NeighborFiles;
};

export type Position = {
	line: number;
	character: number;
};

export type Range = {
	start: Position;
	end: Position;
};

export type WithinRangeCacheScope = {
	kind: CacheScopeKind.WithinRange;
	range: Range;
};

export type OutsideRangeCacheScope = {
	kind: CacheScopeKind.OutsideRange;
	ranges: Range[];
};

export type CacheScope = FileCacheScope | NeighborFilesCacheScope | WithinRangeCacheScope | OutsideRangeCacheScope;

export type ContextItemKey = string;
export enum EmitMode {
	ClientBased = 'clientBased',
	ClientBasedOnTimeout = 'clientBasedOnTimeout'
}
export type CacheInfo = {
	emitMode: EmitMode;
	scope: CacheScope;
};
export namespace CacheInfo {
	export type has = { cache: CacheInfo };
	export function has(item: unknown): item is has {
		return (item as has).cache !== undefined;
	}
}
export type CachedContextItem = {
	key: ContextItemKey;
	sizeInChars?: number;
};
export namespace CachedContextItem {
	export function create(key: ContextItemKey, sizeInChars?: number): CachedContextItem {
		return { key, sizeInChars };
	}
}

export enum ContextKind {
	Reference = 'reference',
	RelatedFile = 'relatedFile',
	Snippet = 'snippet',
	Trait = 'trait',
}

export type ContextItemReference = {
	kind: ContextKind.Reference;
	key: ContextItemKey;
};
export namespace ContextItemReference {
	export function create(key: ContextItemKey): ContextItemReference {
		return { kind: ContextKind.Reference, key };
	}
}

export enum Priorities {
	Expression = 1.0,
	Locals = 0.9,
	Inherited = 0.8,
	Traits = 0.7,
	Blueprints = 0.6,
	Properties = 0.5,
	Imports = 0.4,
	NeighborFiles = 0.3,
	Globals = 0.2
}

export enum SpeculativeKind {
	emit = 'emit',
	ignore = 'ignore'
}

export type RelatedFile = {
	kind: ContextKind.RelatedFile;
	key?: string;
	fileName: FilePath;
	range?: Range;
};

export enum TraitKind {
	Unknown = 'unknown',
	Module = 'module',
	ModuleResolution = 'moduleResolution',
	Lib = 'lib',
	Target = 'target',
	Version = 'version'
}

export type Trait = {
	kind: ContextKind.Trait;

	key: string;

	name: string;

	value: string;
};
export namespace Trait {
	export function create(traitKind: TraitKind, name: string, value: string): Trait {
		return { kind: ContextKind.Trait, key: createContextItemKey(traitKind), name, value };
	}
	export function sizeInChars(trait: Trait): number {
		return trait.name.length + trait.value.length;
	}
	export function createContextItemKey(traitKind: TraitKind): string {
		return JSON.stringify({ k: ContextKind.Trait, tk: traitKind }, undefined, 0);
	}
}

export type CodeSnippet = {
	kind: ContextKind.Snippet;

	key?: string;

	fileName: FilePath;

	additionalFileNames?: FilePath[];

	value: string;
};
export namespace CodeSnippet {
	export function create(key: string | undefined, fileName: FilePath, additionalFileNames: FilePath[] | undefined, value: string): CodeSnippet {
		return { kind: ContextKind.Snippet, key, fileName, additionalFileNames, value };
	}
	export function sizeInChars(snippet: CodeSnippet): number {
		let result: number = snippet.value.length;
		result += snippet.fileName.length + 3;
		if (snippet.additionalFileNames !== undefined) {
			for (const fileName of snippet.additionalFileNames) {
				result += fileName.length + 3;
			}
		}
		return result;
	}
}

export type FullContextItem = RelatedFile | Trait | CodeSnippet;
export type ContextItem = FullContextItem | ContextItemReference;
export namespace ContextItem {
	export type keyed = { key: ContextItemKey } & ContextItem;
	export function hasKey(item: ContextItem): item is { key: ContextItemKey } & ContextItem {
		return (item as { key: ContextItemKey }).key !== undefined;
	}
	export function sizeInChars(item: ContextItem): number {
		switch (item.kind) {
			case ContextKind.Trait:
				return Trait.sizeInChars(item);
			case ContextKind.Snippet:
				return CodeSnippet.sizeInChars(item);
			default:
				return 0;
		}
	}
}

export type PriorityTag = {
	priority: number;
};

export enum ContextRunnableState {
	Created = 'created',
	InProgress = 'inProgress',
	IsFull = 'isFull',
	Finished = 'finished'
}

export type ContextRunnableResultId = string;
export enum ContextRunnableResultKind {
	ComputedResult = 'computedResult',
	CacheEntry = 'cacheEntry',
	Reference = 'reference'
}
export type ContextRunnableResult = {

	kind: ContextRunnableResultKind.ComputedResult;

	id: ContextRunnableResultId;

	state: ContextRunnableState;

	priority: number;

	items: ContextItem[];

	cache?: CacheInfo;

	speculativeKind: SpeculativeKind;

	debugPath?: ContextRunnableResultId | undefined;
};

export type CachedContextRunnableResult = {

	kind: ContextRunnableResultKind.CacheEntry;

	id: ContextRunnableResultId;

	state: ContextRunnableState;

	items: CachedContextItem[];

	cache?: CacheInfo;
};

export type ContextRunnableResultReference = {

	kind: ContextRunnableResultKind.Reference;

	id: ContextRunnableResultId;
};

export type ContextRunnableResultTypes = ContextRunnableResult | ContextRunnableResultReference;

export type ErrorData = {
	code: number;
	message: string;
};
export namespace ErrorData {
	export function create(code: number, message: string): ErrorData {
		return { code, message };
	}
}

export type Timings = {
	totalTime: number;
	computeTime: number;
};
export namespace Timings {
	export function create(totalTime: number, computeTime: number): Timings {
		return { totalTime, computeTime };
	}
}

export enum ContextRequestResultState {
	Created = 'created',
	InProgress = 'inProgress',
	Cancelled = 'cancelled',
	Finished = 'finished'
}

export type ContextRequestResult = {

	state: ContextRequestResultState;

	path?: number[];

	errors?: ErrorData[];

	timings?: Timings;

	timedOut: boolean;

	exhausted: boolean;

	runnableResults?: ContextRunnableResultTypes[];

	contextItems?: ContextItem[];
};

export interface ComputeContextRequestArgs extends tt.server.protocol.FileLocationRequestArgs {
	startTime: number;
	timeBudget: number;
	primaryCharacterBudget: number;
	secondaryCharacterBudget: number;
	includeDocumentation?: boolean;
	neighborFiles?: readonly FilePath[];
	clientSideRunnableResults?: readonly CachedContextRunnableResult[];
}

export interface ComputeContextRequest extends tt.server.protocol.Request {
	arguments?: ComputeContextRequestArgs;
}

export enum ErrorCode {
	noArguments = 'noArguments',
	noProject = 'noProject',
	noProgram = 'noProgram',
	invalidArguments = 'invalidArguments',
	invalidPosition = 'invalidPosition',
	exception = 'exception',
}

export type ComputeContextResponse = (tt.server.protocol.Response & {
	body: ComputeContextResponse.OK | ComputeContextResponse.Failed;
}) | { type: 'cancelled' };

export namespace CustomResponse {

	export type Failed = {
		error: ErrorCode;
		message: string;
		stack?: string;
	};

	export function isError(response: tt.server.protocol.Response): response is tt.server.protocol.Response & { body: Failed } {
		return response.type === 'response' && (response.body as Failed).error !== undefined;
	}
}

export namespace ComputeContextResponse {

	export type OK = ContextRequestResult;

	export type Failed = CustomResponse.Failed;

	export function isCancelled(response: ComputeContextResponse): boolean {
		return (response.type === 'cancelled');
	}

	export function isOk(response: ComputeContextResponse): response is tt.server.protocol.Response & { body: OK } {
		return response.type === 'response' && (response.body as OK).state !== undefined;
	}
	export function isError(response: ComputeContextResponse): response is tt.server.protocol.Response & { body: Failed } {
		if (response.type === 'cancelled') {
			return false;
		}
		return CustomResponse.isError(response);
	}
}

export interface PingResponse extends tt.server.protocol.Response {
	body: PingResponse.OK | PingResponse.Error;
}

export namespace PingResponse {
	export type OK = {
		kind: 'ok';
		session: boolean;
		supported: boolean;
		version?: string;
	};
	export type Error = {
		kind: 'error';
		message: string;
		stack?: string;
	};
}

export enum RenameKind {
	no = 'no',
	yes = 'yes',
	maybe = 'maybe'
}

export namespace RenameKind {
	export function fromString(value: string): RenameKind {
		switch (value) {
			case 'no':
				return RenameKind.no;
			case 'yes':
				return RenameKind.yes;
			case 'maybe':
				return RenameKind.maybe;
			default:
				return RenameKind.no;
		}
	}
}

export namespace PrepareNesRenameResult {
	export type Yes = {
		canRename: RenameKind.yes;
		oldName: string;
		onOldState: boolean;
	};
	export type Maybe = {
		canRename: RenameKind.maybe;
		oldName: string;
		onOldState: boolean;
	};
	export type No = {
		canRename: RenameKind.no;
		timedOut: boolean;
		reason?: string;
	};
}

export type PrepareNesRenameResult = PrepareNesRenameResult.Yes | PrepareNesRenameResult.Maybe | PrepareNesRenameResult.No;

export interface PrepareNesRenameRequest extends tt.server.protocol.Request {
	arguments?: PrepareNesRenameRequestArgs;
}

export interface PrepareNesRenameRequestArgs extends tt.server.protocol.FileLocationRequestArgs {
	oldName: string;
	newName: string;
	lastSymbolRename?: Range;
	startTime: number;
	timeBudget: number;
}

export namespace PrepareNesRenameResponse {

	export type OK = PrepareNesRenameResult;

	export type Failed = CustomResponse.Failed;

	export function isCancelled(response: PrepareNesRenameResponse): boolean {
		return (response.type === 'cancelled');
	}

	export function isOk(response: PrepareNesRenameResponse): response is Omit<tt.server.protocol.Response, 'body'> & { body: OK } {
		return response.type === 'response' && (response.body as OK).canRename !== undefined;
	}
	export function isError(response: PrepareNesRenameResponse): response is Omit<tt.server.protocol.Response, 'body'> & { body: Failed } {
		return response.type === 'response' && (response.body as Failed).error !== undefined;
	}
}

export type PrepareNesRenameResponse = (tt.server.protocol.Response & {
	body: PrepareNesRenameResponse.OK | PrepareNesRenameResponse.Failed;
}) | { type: 'cancelled' };

export interface NesRenameRequest extends tt.server.protocol.Request {
	arguments?: NesRenameRequestArgs;
}

export interface NesRenameRequestArgs extends tt.server.protocol.FileLocationRequestArgs {
	oldName: string;
	newName: string;
	lastSymbolRename?: Range;
}

export type TextChange = {
	range: Range;
	newText?: string;
};

export type RenameGroup = {
	file: FilePath;
	changes: TextChange[];
};

export namespace NesRenameResult {
	export type OK = {
		groups: RenameGroup[];
	};
	export type Failed = CustomResponse.Failed;
}

export namespace NesRenameResponse {

	export type OK = NesRenameResult.OK;

	export type Failed = CustomResponse.Failed;

	export function isCancelled(response: NesRenameResponse): boolean {
		return (response.type === 'cancelled');
	}

	export function isOk(response: NesRenameResponse): response is Omit<tt.server.protocol.Response, 'body'> & { body: OK } {
		return response.type === 'response' && (response.body as NesRenameResult.OK).groups !== undefined;
	}
	export function isError(response: NesRenameResponse): response is Omit<tt.server.protocol.Response, 'body'> & { body: Failed } {
		return response.type === 'response' && (response.body as NesRenameResult.Failed).error !== undefined;
	}
}

export type NesRenameResponse = (tt.server.protocol.Response & {
	body: NesRenameResponse.OK | NesRenameResponse.Failed;
}) | { type: 'cancelled' };
