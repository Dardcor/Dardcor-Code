/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as utils from './utils.ts';
import colors from 'ansi-colors';
import ts from 'typescript';
import Vinyl from 'vinyl';
import { type RawSourceMap, SourceMapConsumer, SourceMapGenerator } from 'source-map';

export interface IConfiguration {
	logFn: (topic: string, message: string) => void;
	_emitWithoutBasePath?: boolean;
}

export interface CancellationToken {
	isCancellationRequested(): boolean;
}

export const CancellationToken = new class {
	None: CancellationToken = {
		isCancellationRequested() { return false; }
	};
};

export interface ITypeScriptBuilder {
	build(out: (file: Vinyl) => void, onError: (err: ts.Diagnostic) => void, token?: CancellationToken): Promise<any>;
	file(file: Vinyl): void;
	languageService: ts.LanguageService;
}

function normalize(path: string): string {
	return path.replace(/\\/g, '/');
}

export function createTypeScriptBuilder(config: IConfiguration, projectFile: string, cmd: ts.ParsedCommandLine): ITypeScriptBuilder {

	const _log = config.logFn;

	const host = new LanguageServiceHost(cmd, projectFile, _log);

	const outHost = new LanguageServiceHost({ ...cmd, options: { ...cmd.options, sourceRoot: cmd.options.outDir } }, cmd.options.outDir ?? '', _log);
	const toBeCheckedForCycles: string[] = [];

	const service = ts.createLanguageService(host, ts.createDocumentRegistry());
	const lastBuildVersion: { [path: string]: string } = Object.create(null);
	const lastDtsHash: { [path: string]: string } = Object.create(null);
	const userWantsDeclarations = cmd.options.declaration;
	let oldErrors: { [path: string]: ts.Diagnostic[] } = Object.create(null);
	let headUsed = process.memoryUsage().heapUsed;
	let emitSourceMapsInStream = true;

	host.getCompilationSettings().declaration = true;

	function file(file: Vinyl): void {
		if (file.sourceMap) {
			emitSourceMapsInStream = false;
		}

		if (!file.contents) {
			host.removeScriptSnapshot(file.path);
			delete lastBuildVersion[normalize(file.path)];
		} else {
			host.addScriptSnapshot(file.path, new VinylScriptSnapshot(file));
		}
	}

	function baseFor(snapshot: ScriptSnapshot): string {
		if (snapshot instanceof VinylScriptSnapshot) {
			return cmd.options.outDir || snapshot.getBase();
		} else {
			return '';
		}
	}

	function isExternalModule(sourceFile: ts.SourceFile): boolean {
		interface SourceFileWithModuleIndicator extends ts.SourceFile {
			externalModuleIndicator?: unknown;
		}
		return !!(sourceFile as SourceFileWithModuleIndicator).externalModuleIndicator
			|| /declare\s+module\s+('|")(.+)\1/.test(sourceFile.getText());
	}

	function build(out: (file: Vinyl) => void, onError: (err: any) => void, token = CancellationToken.None): Promise<any> {

		function checkSyntaxSoon(fileName: string): Promise<ts.Diagnostic[]> {
			return new Promise<ts.Diagnostic[]>(resolve => {
				process.nextTick(function () {
					if (!host.getScriptSnapshot(fileName, false)) {
						resolve([]);
					} else {
						resolve(service.getSyntacticDiagnostics(fileName));
					}
				});
			});
		}

		function checkSemanticsSoon(fileName: string): Promise<ts.Diagnostic[]> {
			return new Promise<ts.Diagnostic[]>(resolve => {
				process.nextTick(function () {
					if (!host.getScriptSnapshot(fileName, false)) {
						resolve([]);
					} else {
						resolve(service.getSemanticDiagnostics(fileName));
					}
				});
			});
		}

		function emitSoon(fileName: string): Promise<{ fileName: string; signature?: string; files: Vinyl[] }> {

			return new Promise(resolve => {
				process.nextTick(function () {

					if (/\.d\.ts$/.test(fileName)) {
						const snapshot = host.getScriptSnapshot(fileName);
						const signature = crypto.createHash('sha256')
							.update(snapshot.getText(0, snapshot.getLength()))
							.digest('base64');

						return resolve({
							fileName,
							signature,
							files: []
						});
					}

					const output = service.getEmitOutput(fileName);
					const files: Vinyl[] = [];
					let signature: string | undefined;

					for (const file of output.outputFiles) {
						if (!emitSourceMapsInStream && /\.js\.map$/.test(file.name)) {
							continue;
						}

						if (/\.d\.ts$/.test(file.name)) {
							signature = crypto.createHash('sha256')
								.update(file.text)
								.digest('base64');

							if (!userWantsDeclarations) {
								continue;
							}
						}

						const vinyl = new Vinyl({
							path: file.name,
							contents: Buffer.from(file.text),
							base: !config._emitWithoutBasePath && baseFor(host.getScriptSnapshot(fileName)) || undefined
						});

						if (!emitSourceMapsInStream && /\.js$/.test(file.name)) {
							const sourcemapFile = output.outputFiles.filter(f => /\.js\.map$/.test(f.name))[0];

							if (sourcemapFile) {
								const extname = path.extname(vinyl.relative);
								const basename = path.basename(vinyl.relative, extname);
								const dirname = path.dirname(vinyl.relative);
								const tsname = (dirname === '.' ? '' : dirname + '/') + basename + '.ts';

								let sourceMap = JSON.parse(sourcemapFile.text) as RawSourceMap;
								sourceMap.sources[0] = tsname.replace(/\\/g, '/');

								const snapshot = host.getScriptSnapshot(fileName);
								if (snapshot instanceof VinylScriptSnapshot && snapshot.sourceMap) {
									const inputSMC = new SourceMapConsumer(snapshot.sourceMap);
									const tsSMC = new SourceMapConsumer(sourceMap);
									let didChange = false;
									const smg = new SourceMapGenerator({
										file: sourceMap.file,
										sourceRoot: sourceMap.sourceRoot
									});

									const lineEdits = new Map<number, [from: number, to: number][]>();
									inputSMC.eachMapping(m => {
										if (m.originalLine === m.generatedLine) {
											let array = lineEdits.get(m.originalLine);
											if (!array) {
												array = [];
												lineEdits.set(m.originalLine, array);
											}
											array.push([m.originalColumn, m.generatedColumn]);
										} else {
										}
									});

									tsSMC.eachMapping(m => {
										didChange = true;
										const edits = lineEdits.get(m.originalLine);
										let originalColumnDelta = 0;
										if (edits) {
											for (const [from, to] of edits) {
												if (to >= m.originalColumn) {
													break;
												}
												originalColumnDelta = from - to;
											}
										}
										smg.addMapping({
											source: m.source,
											name: m.name,
											generated: { line: m.generatedLine, column: m.generatedColumn },
											original: { line: m.originalLine, column: m.originalColumn + originalColumnDelta }
										});
									});

									if (didChange) {

										interface SourceMapGeneratorWithSources extends SourceMapGenerator {
											_sources: { add(source: string): void };
										}

										[tsSMC, inputSMC].forEach((consumer) => {
											(consumer as SourceMapConsumer & { sources: string[] }).sources.forEach((sourceFile: string) => {
												(smg as SourceMapGeneratorWithSources)._sources.add(sourceFile);
												const sourceContent = consumer.sourceContentFor(sourceFile);
												if (sourceContent !== null) {
													smg.setSourceContent(sourceFile, sourceContent);
												}
											});
										}); sourceMap = JSON.parse(smg.toString());

									}
								}

								(vinyl as Vinyl & { sourceMap?: RawSourceMap }).sourceMap = sourceMap;
							}
						} files.push(vinyl);
					}

					resolve({
						fileName,
						signature,
						files
					});
				});
			});
		}

		const newErrors: { [path: string]: ts.Diagnostic[] } = Object.create(null);
		const t1 = Date.now();

		const toBeEmitted: string[] = [];
		const toBeCheckedSyntactically: string[] = [];
		const toBeCheckedSemantically: string[] = [];
		const filesWithChangedSignature: string[] = [];
		const dependentFiles: string[] = [];
		const newLastBuildVersion = new Map<string, string>();

		for (const fileName of host.getScriptFileNames()) {
			if (lastBuildVersion[fileName] !== host.getScriptVersion(fileName)) {

				toBeEmitted.push(fileName);
				toBeCheckedSyntactically.push(fileName);
				toBeCheckedSemantically.push(fileName);
			}
		}

		return new Promise<void>(resolve => {

			const semanticCheckInfo = new Map<string, number>();
			const seenAsDependentFile = new Set<string>();

			function workOnNext() {

				let promise: Promise<any> | undefined;

				if (token.isCancellationRequested()) {
					_log('[CANCEL]', '>>This compile run was cancelled<<');
					newLastBuildVersion.clear();
					resolve();
					return;
				}

				else if (toBeEmitted.length) {
					const fileName = toBeEmitted.pop()!;
					promise = emitSoon(fileName).then(value => {

						for (const file of value.files) {
							_log('[emit code]', file.path);
							out(file);
						}

						newLastBuildVersion.set(fileName, host.getScriptVersion(fileName));

						if (value.signature && lastDtsHash[fileName] !== value.signature) {
							lastDtsHash[fileName] = value.signature;
							filesWithChangedSignature.push(fileName);
						}

						const jsValue = value.files.find(candidate => candidate.basename.endsWith('.js'));
						if (jsValue) {
							outHost.addScriptSnapshot(jsValue.path, new ScriptSnapshot(String(jsValue.contents), new Date()));
							toBeCheckedForCycles.push(normalize(jsValue.path));
						}

					}).catch(e => {
						host.error(`ERROR emitting ${fileName}`);
						host.error(e);
					});
				}

				else if (toBeCheckedSyntactically.length) {
					const fileName = toBeCheckedSyntactically.pop()!;
					_log('[check syntax]', fileName);
					promise = checkSyntaxSoon(fileName).then(diagnostics => {
						delete oldErrors[fileName];
						if (diagnostics.length > 0) {
							diagnostics.forEach(d => onError(d));
							newErrors[fileName] = diagnostics;

							toBeCheckedSyntactically.length = 0;
							toBeCheckedSemantically.length = 0;
							filesWithChangedSignature.length = 0;
						}
					});
				}

				else if (toBeCheckedSemantically.length) {

					let fileName = toBeCheckedSemantically.pop();
					while (fileName && semanticCheckInfo.has(fileName)) {
						fileName = toBeCheckedSemantically.pop()!;
					}

					if (fileName) {
						_log('[check semantics]', fileName);
						promise = checkSemanticsSoon(fileName).then(diagnostics => {
							delete oldErrors[fileName!];
							semanticCheckInfo.set(fileName!, diagnostics.length);
							if (diagnostics.length > 0) {
								diagnostics.forEach(d => onError(d));
								newErrors[fileName!] = diagnostics;
							}
						});
					}
				}

				else if (filesWithChangedSignature.length) {
					while (filesWithChangedSignature.length) {
						const fileName = filesWithChangedSignature.pop()!;

						if (!isExternalModule(service.getProgram()!.getSourceFile(fileName)!)) {
							_log('[check semantics*]', fileName + ' is an internal module and it has changed shape -> check whatever hasn\'t been checked yet');
							toBeCheckedSemantically.push(...host.getScriptFileNames());
							filesWithChangedSignature.length = 0;
							dependentFiles.length = 0;
							break;
						}

						host.collectDependents(fileName, dependentFiles);
					}
				}

				else if (dependentFiles.length) {
					let fileName = dependentFiles.pop();
					while (fileName && seenAsDependentFile.has(fileName)) {
						fileName = dependentFiles.pop();
					}
					if (fileName) {
						seenAsDependentFile.add(fileName);
						const value = semanticCheckInfo.get(fileName);
						if (value === 0) {
							host.collectDependents(fileName, dependentFiles);

						} else if (typeof value === 'undefined') {
							dependentFiles.push(fileName);
							toBeCheckedSemantically.push(fileName);
						}
					}
				}


				else {
					resolve();
					return;
				}

				if (!promise) {
					promise = Promise.resolve();
				}

				promise.then(function () {
					process.nextTick(workOnNext);
				}).catch(err => {
					console.error(err);
				});
			}

			workOnNext();

		}).then(() => {
			const cycles = outHost.getCyclicDependencies(toBeCheckedForCycles);
			toBeCheckedForCycles.length = 0;

			for (const [filename, error] of cycles) {
				const cyclicDepErrors: ts.Diagnostic[] = [];
				if (error) {
					cyclicDepErrors.push({
						category: ts.DiagnosticCategory.Error,
						code: 1,
						file: undefined,
						start: undefined,
						length: undefined,
						messageText: `CYCLIC dependency: ${error}`
					});
				}
				delete oldErrors[filename];
				newErrors[filename] = cyclicDepErrors;
				cyclicDepErrors.forEach(d => onError(d));
			}

		}).then(() => {

			newLastBuildVersion.forEach((value, key) => {
				lastBuildVersion[key] = value;
			});

			for (const [key, value] of Object.entries(oldErrors)) {
				value.forEach(diag => onError(diag));
				newErrors[key] = value;
			}
			oldErrors = newErrors;

			const headNow = process.memoryUsage().heapUsed;
			const MB = 1024 * 1024;
			_log(
				'[tsb]',
				`time:  ${colors.yellow((Date.now() - t1) + 'ms')} + \nmem:  ${colors.cyan(Math.ceil(headNow / MB) + 'MB')} ${colors.bgCyan('delta: ' + Math.ceil((headNow - headUsed) / MB))}`
			);
			headUsed = headNow;
		});
	}

	return {
		file,
		build,
		languageService: service
	};
}

class ScriptSnapshot implements ts.IScriptSnapshot {

	private readonly _text: string;
	private readonly _mtime: Date;

	constructor(text: string, mtime: Date) {
		this._text = text;
		this._mtime = mtime;
	}

	getVersion(): string {
		return this._mtime.toUTCString();
	}

	getText(start: number, end: number): string {
		return this._text.substring(start, end);
	}

	getLength(): number {
		return this._text.length;
	}

	getChangeRange(_oldSnapshot: ts.IScriptSnapshot): ts.TextChangeRange | undefined {
		return undefined;
	}
}

class VinylScriptSnapshot extends ScriptSnapshot {

	private readonly _base: string;

	readonly sourceMap?: RawSourceMap;

	constructor(file: Vinyl & { sourceMap?: RawSourceMap }) {
		super(file.contents!.toString(), file.stat!.mtime);
		this._base = file.base;
		this.sourceMap = file.sourceMap;
	}

	getBase(): string {
		return this._base;
	}
}

class LanguageServiceHost implements ts.LanguageServiceHost {

	private readonly _snapshots: { [path: string]: ScriptSnapshot };
	private readonly _filesInProject: Set<string>;
	private readonly _filesAdded: Set<string>;
	private readonly _dependencies: InstanceType<typeof utils.graph.Graph<string>>;
	private readonly _dependenciesRecomputeList: string[];
	private readonly _fileNameToDeclaredModule: { [path: string]: string[] };

	private _projectVersion: number;
	private readonly _cmdLine: ts.ParsedCommandLine;
	private readonly _projectPath: string;
	private readonly _log: (topic: string, message: string) => void;

	constructor(
		cmdLine: ts.ParsedCommandLine,
		projectPath: string,
		log: (topic: string, message: string) => void
	) {
		this._cmdLine = cmdLine;
		this._projectPath = projectPath;
		this._log = log;
		this._snapshots = Object.create(null);
		this._filesInProject = new Set(this._cmdLine.fileNames);
		this._filesAdded = new Set();
		this._dependencies = new utils.graph.Graph<string>();
		this._dependenciesRecomputeList = [];
		this._fileNameToDeclaredModule = Object.create(null);

		this._projectVersion = 1;
	}

	log(_s: string): void {
	}

	trace(_s: string): void {
	}

	error(s: string): void {
		console.error(s);
	}

	getCompilationSettings(): ts.CompilerOptions {
		return this._cmdLine.options;
	}

	getProjectVersion(): string {
		return String(this._projectVersion);
	}

	getScriptFileNames(): string[] {
		const res = Object.keys(this._snapshots).filter(path => this._filesInProject.has(path) || this._filesAdded.has(path));
		return res;
	}

	getScriptVersion(filename: string): string {
		filename = normalize(filename);
		const result = this._snapshots[filename];
		if (result) {
			return result.getVersion();
		}
		return 'UNKNWON_FILE_' + Math.random().toString(16).slice(2);
	}

	getScriptSnapshot(filename: string, resolve: boolean = true): ScriptSnapshot {
		filename = normalize(filename);
		let result = this._snapshots[filename];
		if (!result && resolve) {
			try {
				result = new VinylScriptSnapshot(new Vinyl({
					path: filename,
					contents: fs.readFileSync(filename),
					base: this.getCompilationSettings().outDir,
					stat: fs.statSync(filename)
				}));
				this.addScriptSnapshot(filename, result);
			} catch (e) {
			}
		}
		return result;
	}

	private static _declareModule = /declare\s+module\s+('|")(.+)\1/g;

	addScriptSnapshot(filename: string, snapshot: ScriptSnapshot): ScriptSnapshot {
		this._projectVersion++;
		filename = normalize(filename);
		const old = this._snapshots[filename];
		if (!old && !this._filesInProject.has(filename) && !filename.endsWith('.d.ts')) {
			this._filesAdded.add(filename);
		}
		if (!old || old.getVersion() !== snapshot.getVersion()) {
			this._dependenciesRecomputeList.push(filename);

			LanguageServiceHost._declareModule.lastIndex = 0;
			let match: RegExpExecArray | null | undefined;
			while ((match = LanguageServiceHost._declareModule.exec(snapshot.getText(0, snapshot.getLength())))) {
				let declaredModules = this._fileNameToDeclaredModule[filename];
				if (!declaredModules) {
					this._fileNameToDeclaredModule[filename] = declaredModules = [];
				}
				declaredModules.push(match[2]);
			}
		}
		this._snapshots[filename] = snapshot;
		return old;
	}

	removeScriptSnapshot(filename: string): boolean {
		filename = normalize(filename);
		this._log('removeScriptSnapshot', filename);
		this._filesInProject.delete(filename);
		this._filesAdded.delete(filename);
		this._projectVersion++;
		delete this._fileNameToDeclaredModule[filename];
		return delete this._snapshots[filename];
	}

	getCurrentDirectory(): string {
		return path.dirname(this._projectPath);
	}

	getDefaultLibFileName(options: ts.CompilerOptions): string {
		return ts.getDefaultLibFilePath(options);
	}

	readonly directoryExists = ts.sys.directoryExists;
	readonly getDirectories = ts.sys.getDirectories;
	readonly fileExists = ts.sys.fileExists;
	readonly readFile = ts.sys.readFile;
	readonly readDirectory = ts.sys.readDirectory;


	collectDependents(filename: string, target: string[]): void {
		while (this._dependenciesRecomputeList.length) {
			this._processFile(this._dependenciesRecomputeList.pop()!);
		}
		filename = normalize(filename);
		const node = this._dependencies.lookup(filename);
		if (node) {
			node.incoming.forEach((entry: any) => target.push(entry.data));
		}
	}

	getCyclicDependencies(filenames: string[]): Map<string, string | undefined> {
		while (this._dependenciesRecomputeList.length) {
			this._processFile(this._dependenciesRecomputeList.pop()!);
		}
		const cycles = this._dependencies.findCycles(filenames.sort((a, b) => a.localeCompare(b)));
		const result = new Map<string, string | undefined>();
		for (const [key, value] of cycles) {
			result.set(key, value?.join(' -> '));
		}
		return result;
	}

	_processFile(filename: string): void {
		if (filename.match(/.*\.d\.ts$/)) {
			return;
		}
		filename = normalize(filename);
		const snapshot = this.getScriptSnapshot(filename);
		if (!snapshot) {
			this._log('processFile', `Missing snapshot for: ${filename}`);
			return;
		}
		const info = ts.preProcessFile(snapshot.getText(0, snapshot.getLength()), true);

		this._dependencies.resetNode(filename);

		info.referencedFiles.forEach(ref => {
			const resolvedPath = path.resolve(path.dirname(filename), ref.fileName);
			const normalizedPath = normalize(resolvedPath);

			this._dependencies.inertEdge(filename, normalizedPath);
		});

		info.importedFiles.forEach(ref => {

			if (!ref.fileName.startsWith('.')) {
				return;
			}
			if (ref.fileName.endsWith('.css')) {
				return;
			}

			const stopDirname = normalize(this.getCurrentDirectory());
			let dirname = filename;
			let found = false;


			while (!found && dirname.indexOf(stopDirname) === 0) {
				dirname = path.dirname(dirname);
				let resolvedPath = path.resolve(dirname, ref.fileName);
				if (resolvedPath.endsWith('.js')) {
					resolvedPath = resolvedPath.slice(0, -3);
				}
				const normalizedPath = normalize(resolvedPath);

				if (this.getScriptSnapshot(normalizedPath + '.ts')) {
					this._dependencies.inertEdge(filename, normalizedPath + '.ts');
					found = true;

				} else if (this.getScriptSnapshot(normalizedPath + '.d.ts')) {
					this._dependencies.inertEdge(filename, normalizedPath + '.d.ts');
					found = true;

				} else if (this.getScriptSnapshot(normalizedPath + '.js')) {
					this._dependencies.inertEdge(filename, normalizedPath + '.js');
					found = true;
				}
			}

			if (!found) {
				for (const key in this._fileNameToDeclaredModule) {
					if (this._fileNameToDeclaredModule[key] && ~this._fileNameToDeclaredModule[key].indexOf(ref.fileName)) {
						this._dependencies.inertEdge(filename, key);
					}
				}
			}
		});
	}
}
