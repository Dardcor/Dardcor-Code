/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, VSBufferReadable, VSBufferReadableStream } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { IExpression, IRelativePattern } from '../../../base/common/glob.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { TernarySearchTree } from '../../../base/common/ternarySearchTree.js';
import { sep } from '../../../base/common/path.js';
import { ReadableStreamEvents } from '../../../base/common/stream.js';
import { startsWithIgnoreCase } from '../../../base/common/strings.js';
import { isNumber } from '../../../base/common/types.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { isWeb } from '../../../base/common/platform.js';
import { Schemas } from '../../../base/common/network.js';
import { IMarkdownString } from '../../../base/common/htmlContent.js';
import { Lazy } from '../../../base/common/lazy.js';


export const IFileService = createDecorator<IFileService>('fileService');

export interface IFileService {

	readonly _serviceBrand: undefined;

	readonly onDidChangeFileSystemProviderRegistrations: Event<IFileSystemProviderRegistrationEvent>;

	readonly onDidChangeFileSystemProviderCapabilities: Event<IFileSystemProviderCapabilitiesChangeEvent>;

	readonly onWillActivateFileSystemProvider: Event<IFileSystemProviderActivationEvent>;

	registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable;

	getProvider(scheme: string): IFileSystemProvider | undefined;

	activateProvider(scheme: string): Promise<void>;

	canHandleResource(resource: URI): Promise<boolean>;

	hasProvider(resource: URI): boolean;

	hasCapability(resource: URI, capability: FileSystemProviderCapabilities): boolean;

	listCapabilities(): Iterable<{ scheme: string; capabilities: FileSystemProviderCapabilities }>;

	readonly onDidFilesChange: Event<FileChangesEvent>;

	readonly onDidRunOperation: Event<FileOperationEvent>;

	resolve(resource: URI, options: IResolveMetadataFileOptions): Promise<IFileStatWithMetadata>;
	resolve(resource: URI, options?: IResolveFileOptions): Promise<IFileStat>;

	resolveAll(toResolve: { resource: URI; options: IResolveMetadataFileOptions }[]): Promise<IFileStatResult[]>;
	resolveAll(toResolve: { resource: URI; options?: IResolveFileOptions }[]): Promise<IFileStatResult[]>;

	stat(resource: URI): Promise<IFileStatWithPartialMetadata>;

	realpath(resource: URI): Promise<URI | undefined>;

	exists(resource: URI): Promise<boolean>;

	readFile(resource: URI, options?: IReadFileOptions, token?: CancellationToken): Promise<IFileContent>;

	readFileStream(resource: URI, options?: IReadFileStreamOptions, token?: CancellationToken): Promise<IFileStreamContent>;

	writeFile(resource: URI, bufferOrReadableOrStream: VSBuffer | VSBufferReadable | VSBufferReadableStream, options?: IWriteFileOptions): Promise<IFileStatWithMetadata>;

	move(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata>;

	canMove(source: URI, target: URI, overwrite?: boolean): Promise<Error | true>;

	copy(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata>;

	canCopy(source: URI, target: URI, overwrite?: boolean): Promise<Error | true>;

	cloneFile(source: URI, target: URI): Promise<void>;

	createFile(resource: URI, bufferOrReadableOrStream?: VSBuffer | VSBufferReadable | VSBufferReadableStream, options?: ICreateFileOptions): Promise<IFileStatWithMetadata>;

	canCreateFile(resource: URI, options?: ICreateFileOptions): Promise<Error | true>;

	createFolder(resource: URI): Promise<IFileStatWithMetadata>;

	del(resource: URI, options?: Partial<IFileDeleteOptions>): Promise<void>;

	canDelete(resource: URI, options?: Partial<IFileDeleteOptions>): Promise<Error | true>;

	readonly onDidWatchError: Event<Error>;

	createWatcher(resource: URI, options: IWatchOptionsWithoutCorrelation & { recursive: false }): IFileSystemWatcher;

	watch(resource: URI, options?: IWatchOptionsWithoutCorrelation): IDisposable;

	dispose(): void;
}

export interface IFileOverwriteOptions {

	readonly overwrite: boolean;
}

export interface IFileUnlockOptions {

	readonly unlock: boolean;
}

export interface IFileAtomicReadOptions {

	readonly atomic: boolean;
}

export interface IFileAtomicOptions {

	readonly postfix: string;
}

export interface IFileAtomicWriteOptions {

	readonly atomic: IFileAtomicOptions | false;
}

export interface IFileAtomicDeleteOptions {

	readonly atomic: IFileAtomicOptions | false;
}

export interface IFileReadLimits {

	size?: number;
}

export interface IFileReadStreamOptions {

	readonly position?: number;

	readonly length?: number;

	readonly limits?: IFileReadLimits;
}

export interface IFileWriteOptions extends IFileOverwriteOptions, IFileUnlockOptions, IFileAtomicWriteOptions {

	readonly create: boolean;

	readonly append?: boolean;
}

export type IFileOpenOptions = IFileOpenForReadOptions | IFileOpenForWriteOptions;

export function isFileOpenForWriteOptions(options: IFileOpenOptions): options is IFileOpenForWriteOptions {
	return options.create === true;
}

export interface IFileOpenForReadOptions {

	readonly create: false;
}

export interface IFileOpenForWriteOptions extends IFileUnlockOptions {

	readonly create: true;

	readonly append?: boolean;
}

export interface IFileDeleteOptions {

	readonly recursive: boolean;

	readonly useTrash: boolean;

	readonly atomic: IFileAtomicOptions | false;
}

export enum FileType {

	Unknown = 0,

	File = 1,

	Directory = 2,

	SymbolicLink = 64
}

export enum FilePermission {

	Readonly = 1,

	Locked = 2,

	Executable = 4
}

export interface IStat {

	readonly type: FileType;

	readonly mtime: number;

	readonly ctime: number;

	readonly size: number;

	readonly permissions?: FilePermission;
}

export interface IWatchOptionsWithoutCorrelation {

	recursive: boolean;

	excludes: string[];

	includes?: Array<string | IRelativePattern>;

	filter?: FileChangeFilter;
}

export interface IWatchOptions extends IWatchOptionsWithoutCorrelation {

	readonly correlationId?: number;
}

export const enum FileChangeFilter {
	UPDATED = 1 << 1,
	ADDED = 1 << 2,
	DELETED = 1 << 3
}

export interface IWatchOptionsWithCorrelation extends IWatchOptions {
	readonly correlationId: number;
}

export interface IFileSystemWatcher extends IDisposable {

	readonly onDidChange: Event<FileChangesEvent>;
}

export function isFileSystemWatcher(thing: unknown): thing is IFileSystemWatcher {
	const candidate = thing as IFileSystemWatcher | undefined;

	return !!candidate && typeof candidate.onDidChange === 'function';
}

export const enum FileSystemProviderCapabilities {

	None = 0,

	FileReadWrite = 1 << 1,

	FileOpenReadWriteClose = 1 << 2,

	FileReadStream = 1 << 4,

	FileFolderCopy = 1 << 3,

	PathCaseSensitive = 1 << 10,

	Readonly = 1 << 11,

	Trash = 1 << 12,

	FileWriteUnlock = 1 << 13,

	FileAtomicRead = 1 << 14,

	FileAtomicWrite = 1 << 15,

	FileAtomicDelete = 1 << 16,

	FileClone = 1 << 17,

	FileRealpath = 1 << 18,

	FileAppend = 1 << 19
}

export interface IFileSystemProvider {

	readonly capabilities: FileSystemProviderCapabilities;
	readonly onDidChangeCapabilities: Event<void>;

	readonly onDidChangeFile: Event<readonly IFileChange[]>;
	readonly onDidWatchError?: Event<string>;
	watch(resource: URI, opts: IWatchOptions): IDisposable;

	stat(resource: URI): Promise<IStat>;
	mkdir(resource: URI): Promise<void>;
	readdir(resource: URI): Promise<[string, FileType][]>;
	delete(resource: URI, opts: IFileDeleteOptions): Promise<void>;

	rename(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void>;
	copy?(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void>;

	readFile?(resource: URI): Promise<Uint8Array>;
	writeFile?(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void>;

	readFileStream?(resource: URI, opts: IFileReadStreamOptions, token: CancellationToken): ReadableStreamEvents<Uint8Array>;

	open?(resource: URI, opts: IFileOpenOptions): Promise<number>;
	close?(fd: number): Promise<void>;
	read?(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>;
	write?(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>;

	cloneFile?(from: URI, to: URI): Promise<void>;
}

export interface IFileSystemProviderWithFileReadWriteCapability extends IFileSystemProvider {
	readFile(resource: URI): Promise<Uint8Array>;
	writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void>;
}

export function hasReadWriteCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithFileReadWriteCapability {
	return !!(provider.capabilities & FileSystemProviderCapabilities.FileReadWrite);
}

export function hasFileAppendCapability(provider: IFileSystemProvider): boolean {
	return !!(provider.capabilities & FileSystemProviderCapabilities.FileAppend);
}

export interface IFileSystemProviderWithFileFolderCopyCapability extends IFileSystemProvider {
	copy(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void>;
}

export function hasFileFolderCopyCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithFileFolderCopyCapability {
	return !!(provider.capabilities & FileSystemProviderCapabilities.FileFolderCopy);
}

export interface IFileSystemProviderWithFileCloneCapability extends IFileSystemProvider {
	cloneFile(from: URI, to: URI): Promise<void>;
}

export function hasFileCloneCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithFileCloneCapability {
	return !!(provider.capabilities & FileSystemProviderCapabilities.FileClone);
}

export interface IFileSystemProviderWithFileRealpathCapability extends IFileSystemProvider {
	realpath(resource: URI): Promise<string>;
}

export function hasFileRealpathCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithFileRealpathCapability {
	return !!(provider.capabilities & FileSystemProviderCapabilities.FileRealpath);
}

export interface IFileSystemProviderWithOpenReadWriteCloseCapability extends IFileSystemProvider {
	open(resource: URI, opts: IFileOpenOptions): Promise<number>;
	close(fd: number): Promise<void>;
	read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>;
	write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>;
}

export function hasOpenReadWriteCloseCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithOpenReadWriteCloseCapability {
	return !!(provider.capabilities & FileSystemProviderCapabilities.FileOpenReadWriteClose);
}

export interface IFileSystemProviderWithFileReadStreamCapability extends IFileSystemProvider {
	readFileStream(resource: URI, opts: IFileReadStreamOptions, token: CancellationToken): ReadableStreamEvents<Uint8Array>;
}

export function hasFileReadStreamCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithFileReadStreamCapability {
	return !!(provider.capabilities & FileSystemProviderCapabilities.FileReadStream);
}

export interface IFileSystemProviderWithFileAtomicReadCapability extends IFileSystemProvider {
	readFile(resource: URI, opts?: IFileAtomicReadOptions): Promise<Uint8Array>;
	enforceAtomicReadFile?(resource: URI): boolean;
}

export function hasFileAtomicReadCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithFileAtomicReadCapability {
	if (!hasReadWriteCapability(provider)) {
		return false;
	}

	return !!(provider.capabilities & FileSystemProviderCapabilities.FileAtomicRead);
}

export interface IFileSystemProviderWithFileAtomicWriteCapability extends IFileSystemProvider {
	writeFile(resource: URI, contents: Uint8Array, opts?: IFileAtomicWriteOptions): Promise<void>;
	enforceAtomicWriteFile?(resource: URI): IFileAtomicOptions | false;
}

export function hasFileAtomicWriteCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithFileAtomicWriteCapability {
	if (!hasReadWriteCapability(provider)) {
		return false;
	}

	return !!(provider.capabilities & FileSystemProviderCapabilities.FileAtomicWrite);
}

export interface IFileSystemProviderWithFileAtomicDeleteCapability extends IFileSystemProvider {
	delete(resource: URI, opts: IFileAtomicDeleteOptions): Promise<void>;
	enforceAtomicDelete?(resource: URI): IFileAtomicOptions | false;
}

export function hasFileAtomicDeleteCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithFileAtomicDeleteCapability {
	return !!(provider.capabilities & FileSystemProviderCapabilities.FileAtomicDelete);
}

export interface IFileSystemProviderWithReadonlyCapability extends IFileSystemProvider {

	readonly capabilities: FileSystemProviderCapabilities.Readonly & FileSystemProviderCapabilities;

	readonly readOnlyMessage?: IMarkdownString;
}

export function hasReadonlyCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithReadonlyCapability {
	return !!(provider.capabilities & FileSystemProviderCapabilities.Readonly);
}

export enum FileSystemProviderErrorCode {
	FileExists = 'EntryExists',
	FileNotFound = 'EntryNotFound',
	FileNotADirectory = 'EntryNotADirectory',
	FileIsADirectory = 'EntryIsADirectory',
	FileExceedsStorageQuota = 'EntryExceedsStorageQuota',
	FileTooLarge = 'EntryTooLarge',
	FileWriteLocked = 'EntryWriteLocked',
	NoPermissions = 'NoPermissions',
	Unavailable = 'Unavailable',
	Unknown = 'Unknown'
}

export interface IFileSystemProviderError extends Error {
	readonly name: string;
	readonly code: FileSystemProviderErrorCode;
}

export class FileSystemProviderError extends Error implements IFileSystemProviderError {

	static create(error: Error | string, code: FileSystemProviderErrorCode): FileSystemProviderError {
		const providerError = new FileSystemProviderError(error.toString(), code);
		markAsFileSystemProviderError(providerError, code);

		return providerError;
	}

	private constructor(message: string, readonly code: FileSystemProviderErrorCode) {
		super(message);
	}
}

export function createFileSystemProviderError(error: Error | string, code: FileSystemProviderErrorCode): FileSystemProviderError {
	return FileSystemProviderError.create(error, code);
}

export function ensureFileSystemProviderError(error?: Error): Error {
	if (!error) {
		return createFileSystemProviderError(localize('unknownError', "Unknown Error"), FileSystemProviderErrorCode.Unknown);
	}

	return error;
}

export function markAsFileSystemProviderError(error: Error, code: FileSystemProviderErrorCode): Error {
	error.name = code ? `${code} (FileSystemError)` : `FileSystemError`;

	return error;
}

export function toFileSystemProviderErrorCode(error: Error | undefined | null): FileSystemProviderErrorCode {

	if (!error) {
		return FileSystemProviderErrorCode.Unknown;
	}

	if (error instanceof FileSystemProviderError) {
		return error.code;
	}

	const match = /^(.+) \(FileSystemError\)$/.exec(error.name);
	if (!match) {
		return FileSystemProviderErrorCode.Unknown;
	}

	switch (match[1]) {
		case FileSystemProviderErrorCode.FileExists: return FileSystemProviderErrorCode.FileExists;
		case FileSystemProviderErrorCode.FileIsADirectory: return FileSystemProviderErrorCode.FileIsADirectory;
		case FileSystemProviderErrorCode.FileNotADirectory: return FileSystemProviderErrorCode.FileNotADirectory;
		case FileSystemProviderErrorCode.FileNotFound: return FileSystemProviderErrorCode.FileNotFound;
		case FileSystemProviderErrorCode.FileTooLarge: return FileSystemProviderErrorCode.FileTooLarge;
		case FileSystemProviderErrorCode.FileWriteLocked: return FileSystemProviderErrorCode.FileWriteLocked;
		case FileSystemProviderErrorCode.NoPermissions: return FileSystemProviderErrorCode.NoPermissions;
		case FileSystemProviderErrorCode.Unavailable: return FileSystemProviderErrorCode.Unavailable;
	}

	return FileSystemProviderErrorCode.Unknown;
}

export function toFileOperationResult(error: Error): FileOperationResult {

	if (error instanceof FileOperationError) {
		return error.fileOperationResult;
	}

	switch (toFileSystemProviderErrorCode(error)) {
		case FileSystemProviderErrorCode.FileNotFound:
			return FileOperationResult.FILE_NOT_FOUND;
		case FileSystemProviderErrorCode.FileIsADirectory:
			return FileOperationResult.FILE_IS_DIRECTORY;
		case FileSystemProviderErrorCode.FileNotADirectory:
			return FileOperationResult.FILE_NOT_DIRECTORY;
		case FileSystemProviderErrorCode.FileWriteLocked:
			return FileOperationResult.FILE_WRITE_LOCKED;
		case FileSystemProviderErrorCode.NoPermissions:
			return FileOperationResult.FILE_PERMISSION_DENIED;
		case FileSystemProviderErrorCode.FileExists:
			return FileOperationResult.FILE_MOVE_CONFLICT;
		case FileSystemProviderErrorCode.FileTooLarge:
			return FileOperationResult.FILE_TOO_LARGE;
		default:
			return FileOperationResult.FILE_OTHER_ERROR;
	}
}

export interface IFileSystemProviderRegistrationEvent {
	readonly added: boolean;
	readonly scheme: string;
	readonly provider?: IFileSystemProvider;
}

export interface IFileSystemProviderCapabilitiesChangeEvent {
	readonly provider: IFileSystemProvider;
	readonly scheme: string;
}

export interface IFileSystemProviderActivationEvent {
	readonly scheme: string;
	join(promise: Promise<void>): void;
}

export const enum FileOperation {
	CREATE,
	DELETE,
	MOVE,
	COPY,
	WRITE
}

export interface IFileOperationEvent {

	readonly resource: URI;
	readonly operation: FileOperation;

	isOperation(operation: FileOperation.DELETE | FileOperation.WRITE): boolean;
	isOperation(operation: FileOperation.CREATE | FileOperation.MOVE | FileOperation.COPY): this is IFileOperationEventWithMetadata;
}

export interface IFileOperationEventWithMetadata extends IFileOperationEvent {
	readonly target: IFileStatWithMetadata;
}

export class FileOperationEvent implements IFileOperationEvent {

	constructor(resource: URI, operation: FileOperation.DELETE | FileOperation.WRITE);
	constructor(resource: URI, operation: FileOperation.CREATE | FileOperation.MOVE | FileOperation.COPY, target: IFileStatWithMetadata);
	constructor(readonly resource: URI, readonly operation: FileOperation, readonly target?: IFileStatWithMetadata) { }

	isOperation(operation: FileOperation.DELETE | FileOperation.WRITE): boolean;
	isOperation(operation: FileOperation.CREATE | FileOperation.MOVE | FileOperation.COPY): this is IFileOperationEventWithMetadata;
	isOperation(operation: FileOperation): boolean {
		return this.operation === operation;
	}
}

export const enum FileChangeType {
	UPDATED,
	ADDED,
	DELETED
}

export interface IFileChange {

	type: FileChangeType;

	readonly resource: URI;

	readonly cId?: number;
}

export class FileChangesEvent {

	private static readonly MIXED_CORRELATION = null;

	private readonly correlationId: number | undefined | typeof FileChangesEvent.MIXED_CORRELATION = undefined;

	constructor(changes: readonly IFileChange[], private readonly ignorePathCasing: boolean) {
		for (const change of changes) {

			switch (change.type) {
				case FileChangeType.ADDED:
					this.rawAdded.push(change.resource);
					break;
				case FileChangeType.UPDATED:
					this.rawUpdated.push(change.resource);
					break;
				case FileChangeType.DELETED:
					this.rawDeleted.push(change.resource);
					break;
			}

			if (this.correlationId !== FileChangesEvent.MIXED_CORRELATION) {
				if (typeof change.cId === 'number') {
					if (this.correlationId === undefined) {
						this.correlationId = change.cId;
					} else if (this.correlationId !== change.cId) {
						this.correlationId = FileChangesEvent.MIXED_CORRELATION;
					}
				} else {
					if (this.correlationId !== undefined) {
						this.correlationId = FileChangesEvent.MIXED_CORRELATION;
					}
				}
			}
		}
	}

	private readonly added = new Lazy(() => {
		const added = TernarySearchTree.forUris<boolean>(() => this.ignorePathCasing);
		added.fill(this.rawAdded.map(resource => [resource, true]));

		return added;
	});

	private readonly updated = new Lazy(() => {
		const updated = TernarySearchTree.forUris<boolean>(() => this.ignorePathCasing);
		updated.fill(this.rawUpdated.map(resource => [resource, true]));

		return updated;
	});

	private readonly deleted = new Lazy(() => {
		const deleted = TernarySearchTree.forUris<boolean>(() => this.ignorePathCasing);
		deleted.fill(this.rawDeleted.map(resource => [resource, true]));

		return deleted;
	});

	contains(resource: URI, ...types: FileChangeType[]): boolean {
		return this.doContains(resource, { includeChildren: false }, ...types);
	}

	affects(resource: URI, ...types: FileChangeType[]): boolean {
		return this.doContains(resource, { includeChildren: true }, ...types);
	}

	private doContains(resource: URI, options: { includeChildren: boolean }, ...types: FileChangeType[]): boolean {
		if (!resource) {
			return false;
		}

		const hasTypesFilter = types.length > 0;

		if (!hasTypesFilter || types.includes(FileChangeType.ADDED)) {
			if (this.added.value.get(resource)) {
				return true;
			}

			if (options.includeChildren && this.added.value.findSuperstr(resource)) {
				return true;
			}
		}

		if (!hasTypesFilter || types.includes(FileChangeType.UPDATED)) {
			if (this.updated.value.get(resource)) {
				return true;
			}

			if (options.includeChildren && this.updated.value.findSuperstr(resource)) {
				return true;
			}
		}

		if (!hasTypesFilter || types.includes(FileChangeType.DELETED)) {
			if (this.deleted.value.findSubstr(resource) ) {
				return true;
			}

			if (options.includeChildren && this.deleted.value.findSuperstr(resource)) {
				return true;
			}
		}

		return false;
	}

	gotAdded(): boolean {
		return this.rawAdded.length > 0;
	}

	gotDeleted(): boolean {
		return this.rawDeleted.length > 0;
	}

	gotUpdated(): boolean {
		return this.rawUpdated.length > 0;
	}

	correlates(correlationId: number): boolean {
		return this.correlationId === correlationId;
	}

	hasCorrelation(): boolean {
		return typeof this.correlationId === 'number';
	}

	readonly rawAdded: URI[] = [];

	readonly rawUpdated: URI[] = [];

	readonly rawDeleted: URI[] = [];
}

export function isParent(path: string, candidate: string, ignoreCase?: boolean): boolean {
	if (!path || !candidate || path === candidate) {
		return false;
	}

	if (candidate.length > path.length) {
		return false;
	}

	if (candidate.charAt(candidate.length - 1) !== sep) {
		candidate += sep;
	}

	if (ignoreCase) {
		return startsWithIgnoreCase(path, candidate);
	}

	return path.indexOf(candidate) === 0;
}

export interface IBaseFileStat {

	readonly resource: URI;

	readonly name: string;

	readonly size?: number;

	readonly mtime?: number;

	readonly ctime?: number;

	readonly etag?: string;

	readonly readonly?: boolean;

	readonly locked?: boolean;

	readonly executable?: boolean;
}

export interface IBaseFileStatWithMetadata extends Required<IBaseFileStat> { }

export interface IFileStat extends IBaseFileStat {

	readonly isFile: boolean;

	readonly isDirectory: boolean;

	readonly isSymbolicLink: boolean;

	children: IFileStat[] | undefined;
}

export interface IFileStatWithMetadata extends IFileStat, IBaseFileStatWithMetadata {
	readonly mtime: number;
	readonly ctime: number;
	readonly etag: string;
	readonly size: number;
	readonly readonly: boolean;
	readonly locked: boolean;
	readonly executable: boolean;
	readonly children: IFileStatWithMetadata[] | undefined;
}

export interface IFileStatResult {
	readonly stat?: IFileStat;
	readonly success: boolean;
}

export interface IFileStatResultWithMetadata extends IFileStatResult {
	readonly stat?: IFileStatWithMetadata;
}

export interface IFileStatWithPartialMetadata extends Omit<IFileStatWithMetadata, 'children'> { }

export interface IFileContent extends IBaseFileStatWithMetadata {

	readonly value: VSBuffer;
}

export interface IFileStreamContent extends IBaseFileStatWithMetadata {

	readonly value: VSBufferReadableStream;
}

export interface IBaseReadFileOptions extends IFileReadStreamOptions {

	readonly etag?: string;
}

export interface IReadFileStreamOptions extends IBaseReadFileOptions { }

export interface IReadFileOptions extends IBaseReadFileOptions {

	readonly atomic?: boolean;
}

export interface IWriteFileOptions {

	readonly mtime?: number;

	readonly etag?: string;

	readonly unlock?: boolean;

	readonly atomic?: IFileAtomicOptions | false;

	readonly append?: boolean;
}

export interface IResolveFileOptions {

	readonly resolveTo?: readonly URI[];

	readonly resolveSingleChildDescendants?: boolean;

	readonly resolveMetadata?: boolean;
}

export interface IResolveMetadataFileOptions extends IResolveFileOptions {
	readonly resolveMetadata: true;
}

export interface ICreateFileOptions {

	readonly overwrite?: boolean;
}

export class FileOperationError extends Error {
	constructor(
		message: string,
		readonly fileOperationResult: FileOperationResult,
		readonly options?: IReadFileOptions | IWriteFileOptions | ICreateFileOptions
	) {
		super(message);
	}
}

export class TooLargeFileOperationError extends FileOperationError {
	constructor(
		message: string,
		override readonly fileOperationResult: FileOperationResult.FILE_TOO_LARGE,
		readonly size: number,
		options?: IReadFileOptions
	) {
		super(message, fileOperationResult, options);
	}
}

export class NotModifiedSinceFileOperationError extends FileOperationError {

	constructor(
		message: string,
		readonly stat: IFileStatWithMetadata,
		options?: IReadFileOptions
	) {
		super(message, FileOperationResult.FILE_NOT_MODIFIED_SINCE, options);
	}
}

export const enum FileOperationResult {
	FILE_IS_DIRECTORY,
	FILE_NOT_FOUND,
	FILE_NOT_MODIFIED_SINCE,
	FILE_MODIFIED_SINCE,
	FILE_MOVE_CONFLICT,
	FILE_WRITE_LOCKED,
	FILE_PERMISSION_DENIED,
	FILE_TOO_LARGE,
	FILE_INVALID_PATH,
	FILE_NOT_DIRECTORY,
	FILE_OTHER_ERROR
}



export const AutoSaveConfiguration = {
	OFF: 'off',
	AFTER_DELAY: 'afterDelay',
	ON_FOCUS_CHANGE: 'onFocusChange',
	ON_WINDOW_CHANGE: 'onWindowChange'
};

export const HotExitConfiguration = {
	OFF: 'off',
	ON_EXIT: 'onExit',
	ON_EXIT_AND_WINDOW_CLOSE: 'onExitAndWindowClose'
};

export const FILES_ASSOCIATIONS_CONFIG = 'files.associations';
export const FILES_EXCLUDE_CONFIG = 'files.exclude';
export const FILES_READONLY_INCLUDE_CONFIG = 'files.readonlyInclude';
export const FILES_READONLY_EXCLUDE_CONFIG = 'files.readonlyExclude';
export const FILES_READONLY_FROM_PERMISSIONS_CONFIG = 'files.readonlyFromPermissions';

export interface IGlobPatterns {
	[filepattern: string]: boolean;
}

export interface IFilesConfiguration {
	files?: IFilesConfigurationNode;
}

export interface IFilesConfigurationNode {
	associations: { [filepattern: string]: string };
	exclude: IExpression;
	watcherExclude: IGlobPatterns;
	watcherInclude: string[];
	encoding: string;
	autoGuessEncoding: boolean;
	candidateGuessEncodings: string[];
	defaultLanguage: string;
	trimTrailingWhitespace: boolean;
	autoSave: string;
	autoSaveDelay: number;
	autoSaveWorkspaceFilesOnly: boolean;
	autoSaveWhenNoErrors: boolean;
	eol: string;
	enableTrash: boolean;
	hotExit: string;
	saveConflictResolution: 'askUser' | 'overwriteFileOnDisk';
	readonlyInclude: IGlobPatterns;
	readonlyExclude: IGlobPatterns;
	readonlyFromPermissions: boolean;
}



export enum FileKind {
	FILE,
	FOLDER,
	ROOT_FOLDER
}

export const ETAG_DISABLED = '';

export function etag(stat: { mtime: number; size: number }): string;
export function etag(stat: { mtime: number | undefined; size: number | undefined }): string | undefined;
export function etag(stat: { mtime: number | undefined; size: number | undefined }): string | undefined {
	if (typeof stat.size !== 'number' || typeof stat.mtime !== 'number') {
		return undefined;
	}

	return stat.mtime.toString(29) + stat.size.toString(31);
}

export async function whenProviderRegistered(file: URI, fileService: IFileService): Promise<void> {
	if (fileService.hasProvider(URI.from({ scheme: file.scheme }))) {
		return;
	}

	return new Promise(resolve => {
		const disposable = fileService.onDidChangeFileSystemProviderRegistrations(e => {
			if (e.scheme === file.scheme && e.added) {
				disposable.dispose();
				resolve();
			}
		});
	});
}

export class ByteSize {

	static readonly KB = 1024;
	static readonly MB = ByteSize.KB * ByteSize.KB;
	static readonly GB = ByteSize.MB * ByteSize.KB;
	static readonly TB = ByteSize.GB * ByteSize.KB;

	static formatSize(size: number): string {
		if (!isNumber(size)) {
			size = 0;
		}

		if (size < ByteSize.KB) {
			return localize('sizeB', "{0}B", size.toFixed(0));
		}

		if (size < ByteSize.MB) {
			return localize('sizeKB', "{0}KB", (size / ByteSize.KB).toFixed(2));
		}

		if (size < ByteSize.GB) {
			return localize('sizeMB', "{0}MB", (size / ByteSize.MB).toFixed(2));
		}

		if (size < ByteSize.TB) {
			return localize('sizeGB', "{0}GB", (size / ByteSize.GB).toFixed(2));
		}

		return localize('sizeTB', "{0}TB", (size / ByteSize.TB).toFixed(2));
	}
}


export function getLargeFileConfirmationLimit(remoteAuthority?: string): number;
export function getLargeFileConfirmationLimit(uri?: URI): number;
export function getLargeFileConfirmationLimit(arg?: string | URI): number {
	const isRemote = typeof arg === 'string' || arg?.scheme === Schemas.vscodeRemote;
	const isLocal = typeof arg !== 'string' && arg?.scheme === Schemas.file;

	if (isLocal) {
		return 1024 * ByteSize.MB;
	}

	if (isRemote) {
		return 10 * ByteSize.MB;
	}

	if (isWeb) {
		return 50 * ByteSize.MB;
	}

	return 1024 * ByteSize.MB;
}

