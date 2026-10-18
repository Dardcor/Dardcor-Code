/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from '../../../../base/common/path.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import * as strings from '../../../../base/common/strings.js';
import * as glob from '../../../../base/common/glob.js';
import * as resources from '../../../../base/common/resources.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileMatch, IFileSearchProviderStats, IFolderQuery, ISearchCompleteStats, IFileQuery, QueryGlobTester, resolvePatternsForProvider, hasSiblingFn, excludeToGlobPattern, DEFAULT_MAX_SEARCH_RESULTS } from './search.js';
import { FileSearchProviderFolderOptions, FileSearchProvider2, FileSearchProviderOptions } from './searchExtTypes.js';
import { OldFileSearchProviderConverter } from './searchExtConversionTypes.js';
import { FolderQuerySearchTree } from './folderQuerySearchTree.js';

interface IInternalFileMatch {
	base: URI;
	original?: URI;
	relativePath?: string;
	basename: string;
	size?: number;
}

interface IDirectoryEntry {
	base: URI;
	relativePath: string;
	basename: string;
}

interface FolderQueryInfo {
	queryTester: QueryGlobTester;
	noSiblingsClauses: boolean;
	folder: URI;
	tree: IDirectoryTree;
}

interface IDirectoryTree {
	rootEntries: IDirectoryEntry[];
	pathToEntries: { [relativePath: string]: IDirectoryEntry[] };
}

class FileSearchEngine {
	private filePattern?: string;
	private includePattern?: glob.ParsedExpression;
	private maxResults?: number;
	private exists?: boolean;
	private isLimitHit = false;
	private resultCount = 0;
	private isCanceled = false;

	private activeCancellationTokens: Set<CancellationTokenSource>;

	private globalExcludePattern?: glob.ParsedExpression;

	constructor(private config: IFileQuery, private provider: FileSearchProvider2, private sessionLifecycle?: SessionLifecycle) {
		this.filePattern = config.filePattern;
		const globOptions = config.ignoreGlobCase ? { ignoreCase: true } : undefined;
		this.includePattern = config.includePattern && glob.parse(config.includePattern, globOptions);
		this.maxResults = config.maxResults || undefined;
		this.exists = config.exists;
		this.activeCancellationTokens = new Set<CancellationTokenSource>();

		this.globalExcludePattern = config.excludePattern && glob.parse(config.excludePattern, globOptions);
	}

	cancel(): void {
		this.isCanceled = true;
		this.activeCancellationTokens.forEach(t => t.cancel());
		this.activeCancellationTokens = new Set();
	}

	search(_onResult: (match: IInternalFileMatch) => void): Promise<IInternalSearchComplete> {
		const folderQueries = this.config.folderQueries || [];

		return new Promise((resolve, reject) => {
			const onResult = (match: IInternalFileMatch) => {
				this.resultCount++;
				_onResult(match);
			};

			if (this.isCanceled) {
				return resolve({ limitHit: this.isLimitHit });
			}

			if (this.config.extraFileResources) {
				this.config.extraFileResources
					.forEach(extraFile => {
						const extraFileStr = extraFile.toString();
						const basename = path.basename(extraFileStr);
						if (this.globalExcludePattern && this.globalExcludePattern(extraFileStr, basename)) {
							return;
						}

						this.matchFile(onResult, { base: extraFile, basename });
					});
			}


			this.doSearch(folderQueries, onResult).then(stats => {
				resolve({
					limitHit: this.isLimitHit,
					stats: stats || undefined
				});
			}, (err: Error) => {
				reject(new Error(toErrorMessage(err)));
			});
		});
	}


	private async doSearch(fqs: IFolderQuery<URI>[], onResult: (match: IInternalFileMatch) => void): Promise<IFileSearchProviderStats | null> {
		const cancellation = new CancellationTokenSource();
		const folderOptions = fqs.map(fq => this.getSearchOptionsForFolder(fq));
		const session = this.provider instanceof OldFileSearchProviderConverter ? this.sessionLifecycle?.tokenSource.token : this.sessionLifecycle?.obj;
		const options: FileSearchProviderOptions = {
			folderOptions,
			maxResults: this.config.maxResults ?? DEFAULT_MAX_SEARCH_RESULTS,
			session
		};


		const getFolderQueryInfo = (fq: IFolderQuery) => {
			const queryTester = new QueryGlobTester(this.config, fq);
			const noSiblingsClauses = !queryTester.hasSiblingExcludeClauses();
			return { queryTester, noSiblingsClauses, folder: fq.folder, tree: this.initDirectoryTree() };
		};

		const folderMappings: FolderQuerySearchTree<FolderQueryInfo> = new FolderQuerySearchTree<FolderQueryInfo>(fqs, getFolderQueryInfo);

		let providerSW: StopWatch;

		try {
			this.activeCancellationTokens.add(cancellation);

			providerSW = StopWatch.create();
			const results = await this.provider.provideFileSearchResults(
				this.config.filePattern || '',
				options,
				cancellation.token);
			const providerTime = providerSW.elapsed();
			const postProcessSW = StopWatch.create();

			if (this.isCanceled && !this.isLimitHit) {
				return null;
			}


			if (results) {
				results.forEach(result => {
					const fqFolderInfo = folderMappings.findQueryFragmentAwareSubstr(result)!;
					const relativePath = path.posix.relative(fqFolderInfo.folder.path, result.path);

					if (fqFolderInfo.noSiblingsClauses) {
						const basename = path.basename(result.path);
						this.matchFile(onResult, { base: fqFolderInfo.folder, relativePath, basename });

						return;
					}

					this.addDirectoryEntries(fqFolderInfo.tree, fqFolderInfo.folder, relativePath, onResult);
				});
			}

			if (this.isCanceled && !this.isLimitHit) {
				return null;
			}

			folderMappings.forEachFolderQueryInfo(e => {
				this.matchDirectoryTree(e.tree, e.queryTester, onResult);
			});

			return {
				providerTime,
				postProcessTime: postProcessSW.elapsed()
			};
		} finally {
			cancellation.dispose();
			this.activeCancellationTokens.delete(cancellation);
		}
	}

	private getSearchOptionsForFolder(fq: IFolderQuery<URI>): FileSearchProviderFolderOptions {
		const includes = resolvePatternsForProvider(this.config.includePattern, fq.includePattern);
		let excludePattern = fq.excludePattern?.map(e => ({
			folder: e.folder,
			patterns: resolvePatternsForProvider(this.config.excludePattern, e.pattern)
		}));
		if (!excludePattern?.length) {
			excludePattern = [{
				folder: undefined,
				patterns: resolvePatternsForProvider(this.config.excludePattern, undefined)
			}];
		}
		const excludes = excludeToGlobPattern(excludePattern);

		return {
			folder: fq.folder,
			excludes,
			includes,
			useIgnoreFiles: {
				local: !fq.disregardIgnoreFiles,
				parent: !fq.disregardParentIgnoreFiles,
				global: !fq.disregardGlobalIgnoreFiles
			},
			followSymlinks: !fq.ignoreSymlinks,
		};
	}

	private initDirectoryTree(): IDirectoryTree {
		const tree: IDirectoryTree = {
			rootEntries: [],
			pathToEntries: Object.create(null)
		};
		tree.pathToEntries['.'] = tree.rootEntries;
		return tree;
	}

	private addDirectoryEntries({ pathToEntries }: IDirectoryTree, base: URI, relativeFile: string, onResult: (result: IInternalFileMatch) => void) {
		if (this.filePattern && strings.equals(relativeFile, this.filePattern, this.config.ignoreGlobCase)) {
			const basename = path.basename(this.filePattern);
			this.matchFile(onResult, { base: base, relativePath: this.filePattern, basename });
		}

		function add(relativePath: string) {
			const basename = path.basename(relativePath);
			const dirname = path.dirname(relativePath);
			let entries = pathToEntries[dirname];
			if (!entries) {
				entries = pathToEntries[dirname] = [];
				add(dirname);
			}
			entries.push({
				base,
				relativePath,
				basename
			});
		}

		add(relativeFile);
	}

	private matchDirectoryTree({ rootEntries, pathToEntries }: IDirectoryTree, queryTester: QueryGlobTester, onResult: (result: IInternalFileMatch) => void) {
		const self = this;
		const filePattern = this.filePattern;
		const ignoreGlobCase = this.config.ignoreGlobCase;
		function matchDirectory(entries: IDirectoryEntry[]) {
			const hasSibling = hasSiblingFn(() => entries.map(entry => entry.basename));
			for (let i = 0, n = entries.length; i < n; i++) {
				const entry = entries[i];
				const { relativePath, basename } = entry;

				if (queryTester.matchesExcludesSync(relativePath, basename, !strings.equals(filePattern, basename, ignoreGlobCase) ? hasSibling : undefined)) {
					continue;
				}

				const sub = pathToEntries[relativePath];
				if (sub) {
					matchDirectory(sub);
				} else {
					if (strings.equals(relativePath, filePattern, ignoreGlobCase)) {
						continue;
					}

					self.matchFile(onResult, entry);
				}

				if (self.isLimitHit) {
					break;
				}
			}
		}
		matchDirectory(rootEntries);
	}

	private matchFile(onResult: (result: IInternalFileMatch) => void, candidate: IInternalFileMatch): void {
		if (!this.includePattern || (candidate.relativePath && this.includePattern(candidate.relativePath, candidate.basename))) {
			if (this.exists || (this.maxResults && this.resultCount >= this.maxResults)) {
				this.isLimitHit = true;
				this.cancel();
			}

			if (!this.isLimitHit) {
				onResult(candidate);
			}
		}
	}
}

interface IInternalSearchComplete {
	limitHit: boolean;
	stats?: IFileSearchProviderStats;
}

class SessionLifecycle {
	private _obj: object | undefined;
	public readonly tokenSource: CancellationTokenSource;

	constructor() {
		this._obj = new Object();
		this.tokenSource = new CancellationTokenSource();
	}

	public get obj() {
		if (this._obj) {
			return this._obj;
		}

		throw new Error('Session object has been dereferenced.');
	}

	cancel() {
		this.tokenSource.cancel();
		this._obj = undefined;
	}
}

export class FileSearchManager {

	private static readonly BATCH_SIZE = 512;

	private readonly sessions = new Map<string, SessionLifecycle>();

	fileSearch(config: IFileQuery, provider: FileSearchProvider2, onBatch: (matches: IFileMatch[]) => void, token: CancellationToken): Promise<ISearchCompleteStats> {
		const sessionTokenSource = this.getSessionTokenSource(config.cacheKey);
		const engine = new FileSearchEngine(config, provider, sessionTokenSource);

		let resultCount = 0;
		const onInternalResult = (batch: IInternalFileMatch[]) => {
			resultCount += batch.length;
			onBatch(batch.map(m => this.rawMatchToSearchItem(m)));
		};

		return this.doSearch(engine, FileSearchManager.BATCH_SIZE, onInternalResult, token).then(
			result => {
				return {
					limitHit: result.limitHit,
					stats: result.stats ? {
						fromCache: false,
						type: 'fileSearchProvider',
						resultCount,
						detailStats: result.stats
					} : undefined,
					messages: []
				};
			});
	}

	clearCache(cacheKey: string): void {
		this.sessions.get(cacheKey)?.cancel();
		this.sessions.delete(cacheKey);
	}

	private getSessionTokenSource(cacheKey: string | undefined): SessionLifecycle | undefined {
		if (!cacheKey) {
			return undefined;
		}

		if (!this.sessions.has(cacheKey)) {
			this.sessions.set(cacheKey, new SessionLifecycle());
		}

		return this.sessions.get(cacheKey);
	}

	private rawMatchToSearchItem(match: IInternalFileMatch): IFileMatch {
		if (match.relativePath) {
			return {
				resource: resources.joinPath(match.base, match.relativePath)
			};
		} else {
			return {
				resource: match.base
			};
		}
	}

	private doSearch(engine: FileSearchEngine, batchSize: number, onResultBatch: (matches: IInternalFileMatch[]) => void, token: CancellationToken): Promise<IInternalSearchComplete> {
		const listener = token.onCancellationRequested(() => {
			engine.cancel();
		});

		const _onResult = (match: IInternalFileMatch) => {
			if (match) {
				batch.push(match);
				if (batchSize > 0 && batch.length >= batchSize) {
					onResultBatch(batch);
					batch = [];
				}
			}
		};

		let batch: IInternalFileMatch[] = [];
		return engine.search(_onResult).then(result => {
			if (batch.length) {
				onResultBatch(batch);
			}

			listener.dispose();
			return result;
		}, error => {
			if (batch.length) {
				onResultBatch(batch);
			}

			listener.dispose();
			return Promise.reject(error);
		});
	}
}
