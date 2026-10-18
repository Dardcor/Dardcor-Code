/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from '../../../../base/common/path.js';
import { Readable } from 'stream';
import { StringDecoder } from 'string_decoder';
import * as arrays from '../../../../base/common/arrays.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import * as glob from '../../../../base/common/glob.js';
import * as normalization from '../../../../base/common/normalization.js';
import { isEqualOrParent } from '../../../../base/common/extpath.js';
import * as platform from '../../../../base/common/platform.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import * as strings from '../../../../base/common/strings.js';
import * as types from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { Promises } from '../../../../base/node/pfs.js';
import { IFileQuery, IFolderQuery, IProgressMessage, ISearchEngineStats, IRawFileMatch, ISearchEngine, ISearchEngineSuccess, isFilePatternMatch, hasSiblingFn } from '../common/search.js';
import { spawnRipgrepCmd } from './ripgrepFileSearch.js';
import { prepareQuery } from '../../../../base/common/fuzzyScorer.js';

interface IDirectoryEntry extends IRawFileMatch {
	base: string;
	basename: string;
}

interface IDirectoryTree {
	rootEntries: IDirectoryEntry[];
	pathToEntries: { [relativePath: string]: IDirectoryEntry[] };
}

const killCmds = new Set<() => void>();
process.on('exit', () => {
	killCmds.forEach(cmd => cmd());
});

export class FileWalker {
	private config: IFileQuery;
	private filePattern: string;
	private normalizedFilePatternLowercase: string | null = null;
	private includePattern: glob.ParsedExpression | undefined;
	private maxResults: number | null;
	private exists: boolean;
	private maxFilesize: number | null = null;
	private isLimitHit: boolean;
	private resultCount: number;
	private isCanceled = false;
	private fileWalkSW: StopWatch | null = null;
	private directoriesWalked: number;
	private filesWalked: number;
	private errors: string[];
	private cmdSW: StopWatch | null = null;
	private cmdResultCount: number = 0;

	private folderExcludePatterns: Map<string, AbsoluteAndRelativeParsedExpression>;
	private globalExcludePattern: glob.ParsedExpression | undefined;

	private walkedPaths: { [path: string]: boolean };

	constructor(config: IFileQuery) {
		this.config = config;
		this.filePattern = config.filePattern || '';
		const globOptions = config.ignoreGlobCase ? { ignoreCase: true } : undefined;
		this.includePattern = config.includePattern && glob.parse(config.includePattern, globOptions);
		this.maxResults = config.maxResults || null;
		this.exists = !!config.exists;
		this.walkedPaths = Object.create(null);
		this.resultCount = 0;
		this.isLimitHit = false;
		this.directoriesWalked = 0;
		this.filesWalked = 0;
		this.errors = [];

		if (this.filePattern) {
			this.normalizedFilePatternLowercase = config.shouldGlobMatchFilePattern ? null : prepareQuery(this.filePattern).normalizedLowercase;
		}

		this.globalExcludePattern = config.excludePattern && glob.parse(config.excludePattern, globOptions);
		this.folderExcludePatterns = new Map<string, AbsoluteAndRelativeParsedExpression>();

		config.folderQueries.forEach(folderQuery => {
			const folderExcludeExpression: glob.IExpression = {};

			folderQuery.excludePattern?.forEach(excludePattern => {
				Object.assign(folderExcludeExpression, excludePattern.pattern || {}, this.config.excludePattern || {});
			});

			if (!folderQuery.excludePattern?.length) {
				Object.assign(folderExcludeExpression, this.config.excludePattern || {});
			}

			const fqPath = folderQuery.folder.fsPath;
			config.folderQueries
				.map(rootFolderQuery => rootFolderQuery.folder.fsPath)
				.filter(rootFolder => rootFolder !== fqPath)
				.forEach(otherRootFolder => {
					if (isEqualOrParent(otherRootFolder, fqPath, config.ignoreGlobCase)) {
						folderExcludeExpression[path.relative(fqPath, otherRootFolder)] = true;
					}
				});

			this.folderExcludePatterns.set(fqPath, new AbsoluteAndRelativeParsedExpression(folderExcludeExpression, fqPath, config.ignoreGlobCase));
		});
	}

	cancel(): void {
		this.isCanceled = true;
		killCmds.forEach(cmd => cmd());
	}

	walk(folderQueries: IFolderQuery[], extraFiles: URI[], numThreads: number | undefined, onResult: (result: IRawFileMatch) => void, onMessage: (message: IProgressMessage) => void, done: (error: Error | null, isLimitHit: boolean) => void): void {
		this.fileWalkSW = StopWatch.create(false);

		if (this.isCanceled) {
			return done(null, this.isLimitHit);
		}

		extraFiles.forEach(extraFilePath => {
			const basename = path.basename(extraFilePath.fsPath);
			if (this.globalExcludePattern && this.globalExcludePattern(extraFilePath.fsPath, basename)) {
				return;
			}

			this.matchFile(onResult, { relativePath: extraFilePath.fsPath , searchPath: undefined });
		});

		this.cmdSW = StopWatch.create(false);

		this.parallel<IFolderQuery, void>(folderQueries, (folderQuery: IFolderQuery, rootFolderDone: (err: Error | null, result: void) => void) => {
			this.call(this.cmdTraversal, this, folderQuery, numThreads, onResult, onMessage, (err?: Error) => {
				if (err) {
					const errorMessage = toErrorMessage(err);
					console.error(errorMessage);
					this.errors.push(errorMessage);
					rootFolderDone(err, undefined);
				} else {
					rootFolderDone(null, undefined);
				}
			});
		}, (errors, _result) => {
			this.fileWalkSW!.stop();
			const err = errors ? arrays.coalesce(errors)[0] : null;
			done(err, this.isLimitHit);
		});
	}

	private parallel<T, E>(list: T[], fn: (item: T, callback: (err: Error | null, result: E | null) => void) => void, callback: (err: Array<Error | null> | null, result: E[]) => void): void {
		const results = new Array(list.length);
		const errors = new Array<Error | null>(list.length);
		let didErrorOccur = false;
		let doneCount = 0;

		if (list.length === 0) {
			return callback(null, []);
		}

		list.forEach((item, index) => {
			fn(item, (error, result) => {
				if (error) {
					didErrorOccur = true;
					results[index] = null;
					errors[index] = error;
				} else {
					results[index] = result;
					errors[index] = null;
				}

				if (++doneCount === list.length) {
					return callback(didErrorOccur ? errors : null, results);
				}
			});
		});
	}

	private call<F extends Function>(fun: F, that: any, ...args: any[]): void {
		try {
			fun.apply(that, args);
		} catch (e) {
			args[args.length - 1](e);
		}
	}

	private async cmdTraversal(folderQuery: IFolderQuery, numThreads: number | undefined, onResult: (result: IRawFileMatch) => void, onMessage: (message: IProgressMessage) => void, cb: (err?: Error) => void): Promise<void> {
		const rootFolder = folderQuery.folder.fsPath;
		const isMac = platform.isMacintosh;

		const killCmd = () => cmd && cmd.kill();
		killCmds.add(killCmd);

		let done = (err?: Error) => {
			killCmds.delete(killCmd);
			done = () => { };
			cb(err);
		};
		let leftover = '';
		const tree = this.initDirectoryTree();

		let ripgrep;
		try {
			ripgrep = await spawnRipgrepCmd(this.config, folderQuery, this.config.includePattern, this.folderExcludePatterns.get(folderQuery.folder.fsPath)!.expression, numThreads);
		} catch (err) {
			done(err instanceof Error ? err : new Error(String(err)));
			return;
		}
		const cmd = ripgrep.cmd;
		const noSiblingsClauses = !Object.keys(ripgrep.siblingClauses).length;

		const escapedArgs = ripgrep.rgArgs.args
			.map(arg => arg.match(/^-/) ? arg : `'${arg}'`)
			.join(' ');

		let rgCmd = `${ripgrep.rgDiskPath} ${escapedArgs}\n - cwd: ${ripgrep.cwd}`;
		if (ripgrep.rgArgs.siblingClauses) {
			rgCmd += `\n - Sibling clauses: ${JSON.stringify(ripgrep.rgArgs.siblingClauses)}`;
		}
		onMessage({ message: rgCmd });

		this.cmdResultCount = 0;
		this.collectStdout(cmd, 'utf8', onMessage, (err: Error | null, stdout?: string, last?: boolean) => {
			if (err) {
				done(err);
				return;
			}
			if (this.isLimitHit) {
				done();
				return;
			}

			const normalized = leftover + (isMac ? normalization.normalizeNFC(stdout || '') : stdout);
			const relativeFiles = normalized.split('\n');

			if (last) {
				const n = relativeFiles.length;
				relativeFiles[n - 1] = relativeFiles[n - 1].trim();
				if (!relativeFiles[n - 1]) {
					relativeFiles.pop();
				}
			} else {
				leftover = relativeFiles.pop() || '';
			}

			if (relativeFiles.length && relativeFiles[0].indexOf('\n') !== -1) {
				done(new Error('Splitting up files failed'));
				return;
			}

			this.cmdResultCount += relativeFiles.length;

			if (noSiblingsClauses) {
				for (const relativePath of relativeFiles) {
					this.matchFile(onResult, { base: rootFolder, relativePath, searchPath: this.getSearchPath(folderQuery, relativePath) });
					if (this.isLimitHit) {
						killCmd();
						break;
					}
				}
				if (last || this.isLimitHit) {
					done();
				}

				return;
			}

			this.addDirectoryEntries(folderQuery, tree, rootFolder, relativeFiles, onResult);

			if (last) {
				this.matchDirectoryTree(tree, rootFolder, onResult);
				done();
			}
		});
	}

	spawnFindCmd(folderQuery: IFolderQuery) {
		const excludePattern = this.folderExcludePatterns.get(folderQuery.folder.fsPath)!;
		const basenames = excludePattern.getBasenameTerms();
		const pathTerms = excludePattern.getPathTerms();
		const args = ['-L', '.'];
		if (basenames.length || pathTerms.length) {
			args.push('-not', '(', '(');
			for (const basename of basenames) {
				args.push('-name', basename);
				args.push('-o');
			}
			for (const path of pathTerms) {
				args.push('-path', path);
				args.push('-o');
			}
			args.pop();
			args.push(')', '-prune', ')');
		}
		args.push('-type', 'f');
		return childProcess.spawn('find', args, { cwd: folderQuery.folder.fsPath });
	}

	readStdout(cmd: childProcess.ChildProcess, encoding: BufferEncoding, cb: (err: Error | null, stdout?: string) => void): void {
		let all = '';
		this.collectStdout(cmd, encoding, () => { }, (err: Error | null, stdout?: string, last?: boolean) => {
			if (err) {
				cb(err);
				return;
			}

			all += stdout;
			if (last) {
				cb(null, all);
			}
		});
	}

	private collectStdout(cmd: childProcess.ChildProcess, encoding: BufferEncoding, onMessage: (message: IProgressMessage) => void, cb: (err: Error | null, stdout?: string, last?: boolean) => void): void {
		let onData = (err: Error | null, stdout?: string, last?: boolean) => {
			if (err || last) {
				onData = () => { };

				this.cmdSW?.stop();
			}
			cb(err, stdout, last);
		};

		let gotData = false;
		if (cmd.stdout) {
			this.forwardData(cmd.stdout, encoding, onData);
			cmd.stdout.once('data', () => gotData = true);
		} else {
			onMessage({ message: 'stdout is null' });
		}

		let stderr: Buffer[];
		if (cmd.stderr) {
			stderr = this.collectData(cmd.stderr);
		} else {
			onMessage({ message: 'stderr is null' });
		}

		cmd.on('error', (err: Error) => {
			onData(err);
		});

		cmd.on('close', (code: number) => {
			let stderrText: string;
			if (!gotData && (stderrText = this.decodeData(stderr, encoding)) && rgErrorMsgForDisplay(stderrText)) {
				onData(new Error(`command failed with error code ${code}: ${this.decodeData(stderr, encoding)}`));
			} else {
				if (this.exists && code === 0) {
					this.isLimitHit = true;
				}
				onData(null, '', true);
			}
		});
	}

	private forwardData(stream: Readable, encoding: BufferEncoding, cb: (err: Error | null, stdout?: string) => void): StringDecoder {
		const decoder = new StringDecoder(encoding);
		stream.on('data', (data: Buffer) => {
			cb(null, decoder.write(data));
		});
		return decoder;
	}

	private collectData(stream: Readable): Buffer[] {
		const buffers: Buffer[] = [];
		stream.on('data', (data: Buffer) => {
			buffers.push(data);
		});
		return buffers;
	}

	private decodeData(buffers: Buffer[], encoding: BufferEncoding): string {
		const decoder = new StringDecoder(encoding);
		return buffers.map(buffer => decoder.write(buffer)).join('');
	}

	private initDirectoryTree(): IDirectoryTree {
		const tree: IDirectoryTree = {
			rootEntries: [],
			pathToEntries: Object.create(null)
		};
		tree.pathToEntries['.'] = tree.rootEntries;
		return tree;
	}

	private addDirectoryEntries(folderQuery: IFolderQuery, { pathToEntries }: IDirectoryTree, base: string, relativeFiles: string[], onResult: (result: IRawFileMatch) => void) {
		const filePatternMatch = this.filePattern && relativeFiles.find(f => strings.equals(f, this.filePattern, this.config.ignoreGlobCase));
		if (filePatternMatch) {
			this.matchFile(onResult, {
				base,
				relativePath: filePatternMatch,
				searchPath: this.getSearchPath(folderQuery, filePatternMatch)
			});
		}

		const add = (relativePath: string) => {
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
				basename,
				searchPath: this.getSearchPath(folderQuery, relativePath),
			});
		};
		relativeFiles.forEach(add);
	}

	private matchDirectoryTree({ rootEntries, pathToEntries }: IDirectoryTree, rootFolder: string, onResult: (result: IRawFileMatch) => void) {
		const self = this;
		const excludePattern = this.folderExcludePatterns.get(rootFolder)!;
		const filePattern = this.filePattern;
		const ignoreGlobCase = this.config.ignoreGlobCase;
		function matchDirectory(entries: IDirectoryEntry[]) {
			self.directoriesWalked++;
			const hasSibling = hasSiblingFn(() => entries.map(entry => entry.basename));
			for (let i = 0, n = entries.length; i < n; i++) {
				const entry = entries[i];
				const { relativePath, basename } = entry;

				if (excludePattern.test(relativePath, basename, !strings.equals(filePattern, basename, ignoreGlobCase) ? hasSibling : undefined)) {
					continue;
				}

				const sub = pathToEntries[relativePath];
				if (sub) {
					matchDirectory(sub);
				} else {
					self.filesWalked++;
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

	getStats(): ISearchEngineStats {
		return {
			cmdTime: this.cmdSW!.elapsed(),
			fileWalkTime: this.fileWalkSW!.elapsed(),
			directoriesWalked: this.directoriesWalked,
			filesWalked: this.filesWalked,
			cmdResultCount: this.cmdResultCount
		};
	}

	private doWalk(folderQuery: IFolderQuery, relativeParentPath: string, files: string[], onResult: (result: IRawFileMatch) => void, done: (error?: Error) => void): void {
		const rootFolder = folderQuery.folder;

		const hasSibling = hasSiblingFn(() => files);
		this.parallel(files, (file: string, clb: (error: Error | null, _?: any) => void): void => {

			if (this.isCanceled || this.isLimitHit) {
				return clb(null);
			}

			const currentRelativePath = relativeParentPath ? [relativeParentPath, file].join(path.sep) : file;
			if (this.folderExcludePatterns.get(folderQuery.folder.fsPath)!.test(currentRelativePath, file, !strings.equals(this.config.filePattern, file, this.config.ignoreGlobCase) ? hasSibling : undefined)) {
				return clb(null);
			}

			const currentAbsolutePath = [rootFolder.fsPath, currentRelativePath].join(path.sep);
			fs.lstat(currentAbsolutePath, (error, lstat) => {
				if (error || this.isCanceled || this.isLimitHit) {
					return clb(null);
				}

				this.statLinkIfNeeded(currentAbsolutePath, lstat, (error, stat) => {
					if (error || this.isCanceled || this.isLimitHit) {
						return clb(null);
					}

					if (stat.isDirectory()) {
						this.directoriesWalked++;

						return this.realPathIfNeeded(currentAbsolutePath, lstat, (error, realpath) => {
							if (error || this.isCanceled || this.isLimitHit) {
								return clb(null);
							}

							realpath = realpath || '';
							if (this.walkedPaths[realpath]) {
								return clb(null);
							}

							this.walkedPaths[realpath] = true;

							return Promises.readdir(currentAbsolutePath).then(children => {
								if (this.isCanceled || this.isLimitHit) {
									return clb(null);
								}

								this.doWalk(folderQuery, currentRelativePath, children, onResult, err => clb(err || null));
							}, error => {
								clb(null);
							});
						});
					}

					else {
						this.filesWalked++;
						if (strings.equals(currentRelativePath, this.filePattern, this.config.ignoreGlobCase)) {
							return clb(null, undefined);
						}

						if (this.maxFilesize && types.isNumber(stat.size) && stat.size > this.maxFilesize) {
							return clb(null, undefined);
						}

						this.matchFile(onResult, {
							base: rootFolder.fsPath,
							relativePath: currentRelativePath,
							searchPath: this.getSearchPath(folderQuery, currentRelativePath),
						});
					}

					return clb(null, undefined);
				});
			});
		}, (error: Array<Error | null> | null): void => {
			const filteredErrors = error ? arrays.coalesce(error) : error;
			return done(filteredErrors && filteredErrors.length > 0 ? filteredErrors[0] : undefined);
		});
	}

	private matchFile(onResult: (result: IRawFileMatch) => void, candidate: IRawFileMatch): void {
		if (this.isFileMatch(candidate) && (!this.includePattern || this.includePattern(candidate.relativePath, path.basename(candidate.relativePath)))) {
			this.resultCount++;

			if (this.exists || (this.maxResults && this.resultCount > this.maxResults)) {
				this.isLimitHit = true;
			}

			if (!this.isLimitHit) {
				onResult(candidate);
			}
		}
	}

	private isFileMatch(candidate: IRawFileMatch): boolean {
		if (this.filePattern) {
			if (this.filePattern === '*') {
				return true;
			}

			if (this.normalizedFilePatternLowercase) {
				return isFilePatternMatch(candidate, this.normalizedFilePatternLowercase);
			} else if (this.filePattern) {
				return isFilePatternMatch(candidate, this.filePattern, false, this.config.ignoreGlobCase);
			}
		}

		return true;
	}

	private statLinkIfNeeded(path: string, lstat: fs.Stats, clb: (error: Error | null, stat: fs.Stats) => void): void {
		if (lstat.isSymbolicLink()) {
			return fs.stat(path, clb);
		}

		return clb(null, lstat);
	}

	private realPathIfNeeded(path: string, lstat: fs.Stats, clb: (error: Error | null, realpath?: string) => void): void {
		if (lstat.isSymbolicLink()) {
			return fs.realpath(path, (error, realpath) => {
				if (error) {
					return clb(error);
				}

				return clb(null, realpath);
			});
		}

		return clb(null, path);
	}

	private getSearchPath(folderQuery: IFolderQuery, relativePath: string): string {
		if (folderQuery.folderName) {
			return path.join(folderQuery.folderName, relativePath);
		}
		return relativePath;
	}
}

export class Engine implements ISearchEngine<IRawFileMatch> {
	private folderQueries: IFolderQuery[];
	private extraFiles: URI[];
	private walker: FileWalker;
	private numThreads?: number;

	constructor(config: IFileQuery, numThreads?: number) {
		this.folderQueries = config.folderQueries;
		this.extraFiles = config.extraFileResources || [];
		this.numThreads = numThreads;

		this.walker = new FileWalker(config);
	}

	search(onResult: (result: IRawFileMatch) => void, onProgress: (progress: IProgressMessage) => void, done: (error: Error | null, complete: ISearchEngineSuccess) => void): void {
		this.walker.walk(this.folderQueries, this.extraFiles, this.numThreads, onResult, onProgress, (err: Error | null, isLimitHit: boolean) => {
			done(err, {
				limitHit: isLimitHit,
				stats: this.walker.getStats(),
				messages: [],
			});
		});
	}

	cancel(): void {
		this.walker.cancel();
	}
}

class AbsoluteAndRelativeParsedExpression {
	private absoluteParsedExpr: glob.ParsedExpression | undefined;
	private relativeParsedExpr: glob.ParsedExpression | undefined;

	constructor(public expression: glob.IExpression, private root: string, private ignoreCase?: boolean) {
		this.init(expression);
	}

	private init(expr: glob.IExpression): void {
		let absoluteGlobExpr: glob.IExpression | undefined;
		let relativeGlobExpr: glob.IExpression | undefined;
		Object.keys(expr)
			.filter(key => expr[key])
			.forEach(key => {
				if (path.isAbsolute(key)) {
					absoluteGlobExpr = absoluteGlobExpr || glob.getEmptyExpression();
					absoluteGlobExpr[key] = expr[key];
				} else {
					relativeGlobExpr = relativeGlobExpr || glob.getEmptyExpression();
					relativeGlobExpr[key] = expr[key];
				}
			});

		const globOptions = { trimForExclusions: true, ignoreCase: this.ignoreCase };
		this.absoluteParsedExpr = absoluteGlobExpr && glob.parse(absoluteGlobExpr, globOptions);
		this.relativeParsedExpr = relativeGlobExpr && glob.parse(relativeGlobExpr, globOptions);
	}

	test(_path: string, basename?: string, hasSibling?: (name: string) => boolean | Promise<boolean>): string | Promise<string | null> | undefined | null {
		return (this.relativeParsedExpr && this.relativeParsedExpr(_path, basename, hasSibling)) ||
			(this.absoluteParsedExpr && this.absoluteParsedExpr(path.join(this.root, _path), basename, hasSibling));
	}

	getBasenameTerms(): string[] {
		const basenameTerms: string[] = [];
		if (this.absoluteParsedExpr) {
			basenameTerms.push(...glob.getBasenameTerms(this.absoluteParsedExpr));
		}

		if (this.relativeParsedExpr) {
			basenameTerms.push(...glob.getBasenameTerms(this.relativeParsedExpr));
		}

		return basenameTerms;
	}

	getPathTerms(): string[] {
		const pathTerms: string[] = [];
		if (this.absoluteParsedExpr) {
			pathTerms.push(...glob.getPathTerms(this.absoluteParsedExpr));
		}

		if (this.relativeParsedExpr) {
			pathTerms.push(...glob.getPathTerms(this.relativeParsedExpr));
		}

		return pathTerms;
	}
}

function rgErrorMsgForDisplay(msg: string): string | undefined {
	const lines = msg.trim().split('\n');
	const firstLine = lines[0].trim();

	if (firstLine.startsWith('Error parsing regex')) {
		return firstLine;
	}

	if (firstLine.startsWith('regex parse error')) {
		return strings.uppercaseFirstLetter(lines[lines.length - 1].trim());
	}

	if (firstLine.startsWith('error parsing glob') ||
		firstLine.startsWith('unsupported encoding')) {
		return firstLine.charAt(0).toUpperCase() + firstLine.substr(1);
	}

	if (firstLine === `Literal '\\n' not allowed.`) {
		return `Literal '\\n' currently not supported`;
	}

	if (firstLine.startsWith('Literal ')) {
		return firstLine;
	}

	return undefined;
}
