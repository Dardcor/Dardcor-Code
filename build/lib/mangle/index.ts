/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import v8 from 'node:v8';
import fs from 'fs';
import path from 'path';
import { type Mapping, SourceMapGenerator } from 'source-map';
import ts from 'typescript';
import { pathToFileURL } from 'url';
import workerpool from 'workerpool';
import { StaticLanguageServiceHost } from './staticLanguageServiceHost.ts';
import * as buildfile from '../../buildfile.ts';

class ShortIdent {

	private static _keywords = new Set(['await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
		'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if',
		'import', 'in', 'instanceof', 'let', 'new', 'null', 'return', 'static', 'super', 'switch', 'this', 'throw',
		'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield']);

	private static _alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890$_'.split('');

	private _value = 0;
	private readonly prefix: string;

	constructor(
		prefix: string
	) {
		this.prefix = prefix;
	}

	next(isNameTaken?: (name: string) => boolean): string {
		const candidate = this.prefix + ShortIdent.convert(this._value);
		this._value++;
		if (ShortIdent._keywords.has(candidate) || /^[_0-9]/.test(candidate) || isNameTaken?.(candidate)) {
			return this.next(isNameTaken);
		}
		return candidate;
	}

	private static convert(n: number): string {
		const base = this._alphabet.length;
		let result = '';
		do {
			const rest = n % base;
			result += this._alphabet[rest];
			n = (n / base) | 0;
		} while (n > 0);
		return result;
	}
}

const FieldType = Object.freeze({
	Public: 0,
	Protected: 1,
	Private: 2
});
type FieldType = typeof FieldType[keyof typeof FieldType];

class ClassData {

	fields = new Map<string, { type: FieldType; pos: number }>();

	private replacements: Map<string, string> | undefined;

	parent: ClassData | undefined;
	children: ClassData[] | undefined;

	readonly fileName: string;
	readonly node: ts.ClassDeclaration | ts.ClassExpression;

	constructor(
		fileName: string,
		node: ts.ClassDeclaration | ts.ClassExpression,
	) {
		this.fileName = fileName;
		this.node = node;

		const candidates: (ts.NamedDeclaration)[] = [];
		for (const member of node.members) {
			if (ts.isMethodDeclaration(member)) {
				candidates.push(member);

			} else if (ts.isPropertyDeclaration(member)) {
				candidates.push(member);

			} else if (ts.isGetAccessor(member)) {
				candidates.push(member);

			} else if (ts.isSetAccessor(member)) {
				candidates.push(member);

			} else if (ts.isConstructorDeclaration(member)) {
				for (const param of member.parameters) {
					if (hasModifier(param, ts.SyntaxKind.PrivateKeyword)
						|| hasModifier(param, ts.SyntaxKind.ProtectedKeyword)
						|| hasModifier(param, ts.SyntaxKind.PublicKeyword)
						|| hasModifier(param, ts.SyntaxKind.ReadonlyKeyword)
					) {
						candidates.push(param);
					}
				}
			}
		}
		for (const member of candidates) {
			const ident = ClassData._getMemberName(member);
			if (!ident) {
				continue;
			}
			const type = ClassData._getFieldType(member);
			this.fields.set(ident, { type, pos: member.name!.getStart() });
		}
	}

	private static _getMemberName(node: ts.NamedDeclaration): string | undefined {
		if (!node.name) {
			return undefined;
		}
		const { name } = node;
		let ident = name.getText();
		if (name.kind === ts.SyntaxKind.ComputedPropertyName) {
			if (name.expression.kind !== ts.SyntaxKind.StringLiteral) {
				return;
			}
			ident = name.expression.getText().slice(1, -1);
		}

		return ident;
	}

	private static _getFieldType(node: ts.Node): FieldType {
		if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) {
			return FieldType.Private;
		} else if (hasModifier(node, ts.SyntaxKind.ProtectedKeyword)) {
			return FieldType.Protected;
		} else {
			return FieldType.Public;
		}
	}

	static _shouldMangle(type: FieldType): boolean {
		return type === FieldType.Private
			|| type === FieldType.Protected
			;
	}

	static makeImplicitPublicActuallyPublic(data: ClassData, reportViolation: (name: string, what: string, why: string) => void): void {
		for (const [name, info] of data.fields) {
			if (info.type !== FieldType.Public) {
				continue;
			}
			let parent: ClassData | undefined = data.parent;
			while (parent) {
				if (parent.fields.get(name)?.type === FieldType.Protected) {
					const parentPos = parent.node.getSourceFile().getLineAndCharacterOfPosition(parent.fields.get(name)!.pos);
					const infoPos = data.node.getSourceFile().getLineAndCharacterOfPosition(info.pos);
					reportViolation(name, `'${name}' from ${parent.fileName}:${parentPos.line + 1}`, `${data.fileName}:${infoPos.line + 1}`);

					parent.fields.get(name)!.type = FieldType.Public;
				}
				parent = parent.parent;
			}
		}
	}

	static fillInReplacement(data: ClassData) {

		if (data.replacements) {
			return;
		}

		if (data.parent) {
			ClassData.fillInReplacement(data.parent);
		}

		data.replacements = new Map();

		const isNameTaken = (name: string) => {
			if (data._isNameTaken(name)) {
				return true;
			}

			let parent: ClassData | undefined = data.parent;
			while (parent) {
				if (parent._isNameTaken(name)) {
					return true;
				}
				parent = parent.parent;
			}

			if (data.children) {
				const stack = [...data.children];
				while (stack.length) {
					const node = stack.pop()!;
					if (node._isNameTaken(name)) {
						return true;
					}
					if (node.children) {
						stack.push(...node.children);
					}
				}
			}

			return false;
		};
		const identPool = new ShortIdent('');

		for (const [name, info] of data.fields) {
			if (ClassData._shouldMangle(info.type)) {
				const shortName = identPool.next(isNameTaken);
				data.replacements.set(name, shortName);
			}
		}
	}

	private _isNameTaken(name: string) {
		if (this.fields.has(name) && !ClassData._shouldMangle(this.fields.get(name)!.type)) {
			return true;
		}
		if (this.replacements) {
			for (const shortName of this.replacements.values()) {
				if (shortName === name) {
					return true;
				}
			}
		}

		if (isNameTakenInFile(this.node, name)) {
			return true;
		}

		return false;
	}

	lookupShortName(name: string): string {
		let value = this.replacements!.get(name)!;
		let parent = this.parent;
		while (parent) {
			if (parent.replacements!.has(name) && parent.fields.get(name)?.type === FieldType.Protected) {
				value = parent.replacements!.get(name)! ?? value;
			}
			parent = parent.parent;
		}
		return value;
	}


	addChild(child: ClassData) {
		this.children ??= [];
		this.children.push(child);
		child.parent = this;
	}
}

declare module 'typescript' {
	interface SourceFile {
		identifiers?: Map<string, true>;
	}
}

function isNameTakenInFile(node: ts.Node, name: string): boolean {
	const identifiers = node.getSourceFile().identifiers;
	if (identifiers instanceof Map) {
		if (identifiers.has(name)) {
			return true;
		}
	}
	return false;
}

const skippedExportMangledFiles = [

	'editorCommon',
	'editorOptions',
	'editorZoom',
	'standaloneEditor',
	'standaloneEnums',
	'standaloneLanguages',

	'extensionsApiProposals',

	'pfs',

	...[
		buildfile.workerEditor,
		buildfile.workerExtensionHost,
		buildfile.workerNotebook,
		buildfile.workerLanguageDetection,
		buildfile.workerLocalFileSearch,
		buildfile.workerProfileAnalysis,
		buildfile.workerOutputLinks,
		buildfile.workerBackgroundTokenization,
		buildfile.workbenchDesktop,
		buildfile.workbenchWeb,
		buildfile.code,
		buildfile.codeWeb
	].flat().map(x => x.name),
];

const skippedExportMangledProjects = [
	'vscode-api-tests',

	'configuration-editing',
	'html-language-features/server',
];

const skippedExportMangledSymbols = [
	'activate',
	'deactivate',
];

class DeclarationData {

	readonly replacementName: string;
	readonly fileName: string;
	readonly node: ts.FunctionDeclaration | ts.ClassDeclaration | ts.EnumDeclaration | ts.VariableDeclaration;

	constructor(
		fileName: string,
		node: ts.FunctionDeclaration | ts.ClassDeclaration | ts.EnumDeclaration | ts.VariableDeclaration,
		fileIdents: ShortIdent,
	) {
		this.fileName = fileName;
		this.node = node;
		this.replacementName = fileIdents.next();
	}

	getLocations(service: ts.LanguageService): Iterable<{ fileName: string; offset: number }> {
		if (ts.isVariableDeclaration(this.node)) {
			const definitionResult = service.getDefinitionAndBoundSpan(this.fileName, this.node.name.getStart());
			if (definitionResult?.definitions && definitionResult.definitions.length > 1) {
				return definitionResult.definitions.map(x => ({ fileName: x.fileName, offset: x.textSpan.start }));
			}
		}

		return [{
			fileName: this.fileName,
			offset: this.node.name!.getStart()
		}];
	}

	shouldMangle(newName: string): boolean {
		const currentName = this.node.name!.getText();
		if (currentName.startsWith('$') || skippedExportMangledSymbols.includes(currentName)) {
			return false;
		}

		if (newName.length >= currentName.length) {
			return false;
		}

		if (this.node.getFullText().includes('@skipMangle')) {
			return false;
		}

		return true;
	}
}

export interface MangleOutput {
	out: string;
	sourceMap?: string;
}

export class Mangler {

	private readonly allClassDataByKey = new Map<string, ClassData>();
	private readonly allExportedSymbols = new Set<DeclarationData>();

	private readonly renameWorkerPool: workerpool.WorkerPool;

	private readonly projectPath: string;
	private readonly log: typeof console.log;
	private readonly config: { readonly manglePrivateFields: boolean; readonly mangleExports: boolean };

	constructor(
		projectPath: string,
		log: typeof console.log = () => { },
		config: { readonly manglePrivateFields: boolean; readonly mangleExports: boolean },
	) {
		this.projectPath = projectPath;
		this.log = log;
		this.config = config;

		this.renameWorkerPool = workerpool.pool(path.join(import.meta.dirname, 'renameWorker.ts'), {
			maxWorkers: 4,
			minWorkers: 'max'
		});
	}

	async computeNewFileContents(strictImplicitPublicHandling?: Set<string>): Promise<Map<string, MangleOutput>> {

		const service = ts.createLanguageService(new StaticLanguageServiceHost(this.projectPath));

		// - Find exported symbols.

		const fileIdents = new ShortIdent('$');

		const visit = (node: ts.Node): void => {
			if (this.config.manglePrivateFields) {
				if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
					const anchor = node.name ?? node;
					const key = `${node.getSourceFile().fileName}|${anchor.getStart()}`;
					if (this.allClassDataByKey.has(key)) {
						throw new Error('DUPE?');
					}
					this.allClassDataByKey.set(key, new ClassData(node.getSourceFile().fileName, node));
				}
			}

			if (this.config.mangleExports) {
				// Find exported classes, functions, and vars
				if (
					(
						ts.isClassDeclaration(node)
						&& hasModifier(node, ts.SyntaxKind.ExportKeyword)
						&& node.name
					) || (
						ts.isFunctionDeclaration(node)
						&& ts.isSourceFile(node.parent)
						&& hasModifier(node, ts.SyntaxKind.ExportKeyword)
						&& node.name && node.body
					) || (
						ts.isVariableDeclaration(node)
						&& hasModifier(node.parent.parent, ts.SyntaxKind.ExportKeyword)
						&& ts.isSourceFile(node.parent.parent.parent)
					)

				) {
					if (isInAmbientContext(node)) {
						return;
					}

					this.allExportedSymbols.add(new DeclarationData(node.getSourceFile().fileName, node, fileIdents));
				}
			}

			ts.forEachChild(node, visit);
		};

		for (const file of service.getProgram()!.getSourceFiles()) {
			if (!file.isDeclarationFile) {
				ts.forEachChild(file, visit);
			}
		}
		this.log(`Done collecting. Classes: ${this.allClassDataByKey.size}. Exported symbols: ${this.allExportedSymbols.size}`);



		const setupParents = (data: ClassData) => {
			const extendsClause = data.node.heritageClauses?.find(h => h.token === ts.SyntaxKind.ExtendsKeyword);
			if (!extendsClause) {
				return;
			}

			const info = service.getDefinitionAtPosition(data.fileName, extendsClause.types[0].expression.getEnd());
			if (!info || info.length === 0) {
				return;
			}

			if (info.length !== 1) {
				return;
			}

			const [definition] = info;
			const key = `${definition.fileName}|${definition.textSpan.start}`;
			const parent = this.allClassDataByKey.get(key);
			if (!parent) {
				return;
			}
			parent.addChild(data);
		};
		for (const data of this.allClassDataByKey.values()) {
			setupParents(data);
		}

		const violations = new Map<string, string[]>();
		let violationsCauseFailure = false;
		for (const data of this.allClassDataByKey.values()) {
			ClassData.makeImplicitPublicActuallyPublic(data, (name: string, what, why) => {
				const arr = violations.get(what);
				if (arr) {
					arr.push(why);
				} else {
					violations.set(what, [why]);
				}

				if (strictImplicitPublicHandling && !strictImplicitPublicHandling.has(name)) {
					violationsCauseFailure = true;
				}
			});
		}
		for (const [why, whys] of violations) {
			this.log(`WARN: ${why} became PUBLIC because of: ${whys.join(' , ')}`);
		}
		if (violationsCauseFailure) {
			const message = 'Protected fields have been made PUBLIC. This hurts minification and is therefore not allowed. Review the WARN messages further above';
			this.log(`ERROR: ${message}`);
			throw new Error(message);
		}

		for (const data of this.allClassDataByKey.values()) {
			ClassData.fillInReplacement(data);
		}
		this.log(`Done creating class replacements`);

		this.log(`Starting prepare rename edits`);

		type Edit = { newText: string; offset: number; length: number };
		const editsByFile = new Map<string, Edit[]>();

		const appendEdit = (fileName: string, edit: Edit) => {
			const edits = editsByFile.get(fileName);
			if (!edits) {
				editsByFile.set(fileName, [edit]);
			} else {
				edits.push(edit);
			}
		};
		const appendRename = (newText: string, loc: ts.RenameLocation) => {
			appendEdit(loc.fileName, {
				newText: (loc.prefixText || '') + newText + (loc.suffixText || ''),
				offset: loc.textSpan.start,
				length: loc.textSpan.length
			});
		};

		type RenameFn = (projectName: string, fileName: string, pos: number) => ts.RenameLocation[];

		const renameResults: Array<Promise<{ readonly newName: string; readonly locations: readonly ts.RenameLocation[] }>> = [];

		const queueRename = (fileName: string, pos: number, newName: string) => {
			renameResults.push(Promise.resolve(this.renameWorkerPool.exec<RenameFn>('findRenameLocations', [this.projectPath, fileName, pos]))
				.then((locations) => ({ newName, locations })));
		};

		for (const data of this.allClassDataByKey.values()) {
			if (hasModifier(data.node, ts.SyntaxKind.DeclareKeyword)) {
				continue;
			}

			fields: for (const [name, info] of data.fields) {
				if (!ClassData._shouldMangle(info.type)) {
					continue fields;
				}

				let parent = data.parent;
				while (parent) {
					if (parent.fields.get(name)?.type === FieldType.Public) {
						continue fields;
					}
					parent = parent.parent;
				}

				const newName = data.lookupShortName(name);
				queueRename(data.fileName, info.pos, newName);
			}
		}

		for (const data of this.allExportedSymbols.values()) {
			if (data.fileName.endsWith('.d.ts')
				|| skippedExportMangledProjects.some(proj => data.fileName.includes(proj))
				|| skippedExportMangledFiles.some(file => data.fileName.endsWith(file + '.ts'))
			) {
				continue;
			}

			if (!data.shouldMangle(data.replacementName)) {
				continue;
			}

			const newText = data.replacementName;
			for (const { fileName, offset } of data.getLocations(service)) {
				queueRename(fileName, offset, newText);
			}
		}

		await Promise.all(renameResults).then((result) => {
			for (const { newName, locations } of result) {
				for (const loc of locations) {
					appendRename(newName, loc);
				}
			}
		});

		await this.renameWorkerPool.terminate();

		this.log(`Done preparing edits: ${editsByFile.size} files`);

		const result = new Map<string, MangleOutput>();
		let savedBytes = 0;

		for (const item of service.getProgram()!.getSourceFiles()) {

			const { mapRoot, sourceRoot } = service.getProgram()!.getCompilerOptions();
			const projectDir = path.dirname(this.projectPath);
			const sourceMapRoot = mapRoot ?? pathToFileURL(sourceRoot ?? projectDir).toString();

			let generator: SourceMapGenerator | undefined;

			let newFullText: string;
			const edits = editsByFile.get(item.fileName);
			if (!edits) {
				newFullText = item.getFullText();

			} else {
				const relativeFileName = normalize(path.relative(projectDir, item.fileName));
				const mappingsByLine = new Map<number, Mapping[]>();

				edits.sort((a, b) => b.offset - a.offset);
				const characters = item.getFullText().split('');

				let lastEdit: Edit | undefined;

				for (const edit of edits) {
					if (lastEdit && lastEdit.offset === edit.offset) {
						if (lastEdit.length !== edit.length || lastEdit.newText !== edit.newText) {
							this.log('ERROR: Overlapping edit', item.fileName, edit.offset, edits);
							throw new Error('OVERLAPPING edit');
						} else {
							continue;
						}
					}
					lastEdit = edit;
					const mangledName = characters.splice(edit.offset, edit.length, edit.newText).join('');
					savedBytes += mangledName.length - edit.newText.length;

					const pos = item.getLineAndCharacterOfPosition(edit.offset);


					let mappings = mappingsByLine.get(pos.line);
					if (!mappings) {
						mappings = [];
						mappingsByLine.set(pos.line, mappings);
					}
					mappings.unshift({
						source: relativeFileName,
						original: { line: pos.line + 1, column: pos.character },
						generated: { line: pos.line + 1, column: pos.character },
						name: mangledName
					}, {
						source: relativeFileName,
						original: { line: pos.line + 1, column: pos.character + edit.length },
						generated: { line: pos.line + 1, column: pos.character + edit.newText.length },
					});
				}

				generator = new SourceMapGenerator({ file: path.basename(item.fileName), sourceRoot: sourceMapRoot });
				generator.setSourceContent(relativeFileName, item.getFullText());
				for (const [, mappings] of mappingsByLine) {
					let lineDelta = 0;
					for (const mapping of mappings) {
						generator.addMapping({
							...mapping,
							generated: { line: mapping.generated.line, column: mapping.generated.column - lineDelta }
						});
						lineDelta += mapping.original.column - mapping.generated.column;
					}
				}

				newFullText = characters.join('');
			}
			result.set(item.fileName, { out: newFullText, sourceMap: generator?.toString() });
		}

		service.dispose();
		this.renameWorkerPool.terminate();

		this.log(`Done: ${savedBytes / 1000}kb saved, memory-usage: ${JSON.stringify(v8.getHeapStatistics())}`);
		return result;
	}
}


function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
	const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
	return Boolean(modifiers?.find(mode => mode.kind === kind));
}

function isInAmbientContext(node: ts.Node): boolean {
	for (let p = node.parent; p; p = p.parent) {
		if (ts.isModuleDeclaration(p)) {
			return true;
		}
	}
	return false;
}

function normalize(path: string): string {
	return path.replace(/\\/g, '/');
}

async function _run() {
	const root = path.join(import.meta.dirname, '..', '..', '..');
	const projectBase = path.join(root, 'src');
	const projectPath = path.join(projectBase, 'tsconfig.json');
	const newProjectBase = path.join(path.dirname(projectBase), path.basename(projectBase) + '2');

	fs.cpSync(projectBase, newProjectBase, { recursive: true });

	const mangler = new Mangler(projectPath, console.log, {
		mangleExports: true,
		manglePrivateFields: true,
	});
	for (const [fileName, contents] of await mangler.computeNewFileContents(new Set(['saveState']))) {
		const newFilePath = path.join(newProjectBase, path.relative(projectBase, fileName));
		await fs.promises.mkdir(path.dirname(newFilePath), { recursive: true });
		await fs.promises.writeFile(newFilePath, contents.out);
		if (contents.sourceMap) {
			await fs.promises.writeFile(newFilePath + '.map', contents.sourceMap);
		}
	}
}

if (import.meta.main) {
	_run();
}
