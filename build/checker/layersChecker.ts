/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { API, SymbolFlags, type Checker, type Program, type Project, type Symbol } from '@typescript/native/unstable/async';
import { isExportSpecifier, isIdentifier, isImportSpecifier, isPropertyAccessExpression, type Identifier, type Node, type SourceFile } from '@typescript/native/unstable/ast';
import { dirname, join, relative, resolve } from 'path';
import minimatch from 'minimatch';


const NATIVE_TYPES = [
	'NativeParsedArgs',
	'INativeEnvironmentService',
	'AbstractNativeEnvironmentService',
	'INativeWindowConfiguration',
	'ICommonNativeHostService',
	'INativeHostService',
	'IMainProcessService',
];

export const RULES: IRule[] = [

	{
		target: '**/dc/**/test/**',
		skip: true
	},

	{
		target: `**/dc/platform/{${[
			'environment/common/*.ts',
			'window/common/window.ts',
			'native/common/native.ts',
			'native/common/nativeHostService.ts',
			'ipc/common/mainProcessService.ts'
		].join(',')}}`,
		disallowedTypes: [],
	},

	{
		target: '**/dc/base/parts/sandbox/electron-browser/preload{,-aux}.ts',
		disallowedTypes: NATIVE_TYPES,
	},

	{
		target: '**/dc/platform/browserView/electron-browser/preload-browserView.ts',
		disallowedTypes: NATIVE_TYPES,
	},

	{
		target: '**/dc/base/parts/ipc/electron-main/ipcMain.ts',
		disallowedTypes: [],
	},

	{
		target: '**/dc/**/common/**',
		disallowedTypes: NATIVE_TYPES,
	},

	{
		target: '**/dc/**/worker/**',
		disallowedTypes: NATIVE_TYPES,
	},

	{
		target: '**/dc/**/browser/**',
		disallowedTypes: NATIVE_TYPES,
	},

	{
		target: '**/dc/**/{electron-main,electron-utility}/**',
		disallowedTypes: [
			'ipcMain'
		]
	}
];

const TS_CONFIG_PATH = join(import.meta.dirname, '../../', 'src', 'tsconfig.json');

const SYMBOL_BATCH_SIZE = 20_000;

export interface IRule {
	target: string;
	skip?: boolean;
	disallowedTypes?: string[];
}

export interface ILayerViolation {
	type: string;
	target: string;
	fileName: string;
	line: number;
	character: number;
}

interface ICandidate {
	readonly node: Identifier;
	readonly sourceFile: SourceFile;
	readonly rule: IRule;
}

interface IDisallowedSymbols {
	readonly symbolIds: Map<number, string>;
	readonly memberNames: Set<string>;
	readonly resolvedTypes: Set<string>;
}

export function getRule(fileName: string, rootPath: string, rules: readonly IRule[]): IRule | undefined {
	const relativeFileName = relative(rootPath, fileName).replaceAll('\\', '/');
	return rules.find(rule => minimatch(relativeFileName, rule.target));
}

function forEachNode(node: Node, callback: (node: Node) => void): void {
	callback(node);
	node.forEachChild(child => {
		forEachNode(child, callback);
		return undefined;
	});
}

function collectNamedReferences(sourceFile: SourceFile, disallowedTypes: ReadonlySet<string>): Identifier[] {
	const candidateNames = new Set(disallowedTypes);
	const identifiers: Identifier[] = [];

	forEachNode(sourceFile, node => {
		if ((isImportSpecifier(node) || isExportSpecifier(node)) && disallowedTypes.has((node.propertyName ?? node.name).text)) {
			candidateNames.add(node.name.text);
		}
	});

	forEachNode(sourceFile, node => {
		if (isIdentifier(node) && candidateNames.has(node.text)) {
			identifiers.push(node);
		}
	});

	return identifiers;
}

function collectMemberReferences(sourceFile: SourceFile, memberNames: ReadonlySet<string>): Identifier[] {
	const identifiers: Identifier[] = [];

	forEachNode(sourceFile, node => {
		if (isIdentifier(node) && memberNames.has(node.text) && isPropertyAccessExpression(node.parent) && node.parent.name === node) {
			identifiers.push(node);
		}
	});

	return identifiers;
}

function isSymbol(symbol: Symbol | undefined): symbol is Symbol {
	return !!symbol;
}

async function getSymbols(checker: Checker, nodes: readonly Node[]): Promise<(Symbol | undefined)[]> {
	const symbols: (Symbol | undefined)[] = [];

	for (let i = 0; i < nodes.length; i += SYMBOL_BATCH_SIZE) {
		symbols.push(...await checker.getSymbolAtLocation(nodes.slice(i, i + SYMBOL_BATCH_SIZE)));
	}

	return symbols;
}

async function addDisallowedSymbols(checker: Checker, symbols: readonly Symbol[], disallowedTypes: ReadonlySet<string>, disallowed: IDisallowedSymbols): Promise<void> {
	for (const symbol of symbols) {
		if (disallowed.symbolIds.has(symbol.id)) {
			continue;
		}

		const declaration = symbol.flags & SymbolFlags.Alias ? await checker.getAliasedSymbol(symbol) : symbol;
		if (!disallowedTypes.has(declaration.name)) {
			continue;
		}

		disallowed.symbolIds.set(symbol.id, declaration.name);
		disallowed.symbolIds.set(declaration.id, declaration.name);

		if (disallowed.resolvedTypes.has(declaration.name)) {
			continue;
		}
		disallowed.resolvedTypes.add(declaration.name);

		for (const members of [await declaration.getMembers(), await declaration.getExports()]) {
			for (const member of members.values()) {
				disallowed.symbolIds.set(member.id, declaration.name);
				disallowed.memberNames.add(member.name);
			}
		}
	}
}

function toViolation(candidate: ICandidate, type: string): ILayerViolation {
	const { line, character } = candidate.sourceFile.getLineAndCharacterOfPosition(candidate.node.getStart(candidate.sourceFile));

	return {
		type,
		target: candidate.rule.target,
		fileName: candidate.sourceFile.fileName,
		line: line + 1,
		character: character + 1,
	};
}

async function resolveRemainingTypes(program: Program, checker: Checker, fileNames: readonly string[], disallowedTypes: ReadonlySet<string>, disallowed: IDisallowedSymbols): Promise<void> {
	const remaining = new Set([...disallowedTypes].filter(type => !disallowed.resolvedTypes.has(type)));
	if (!remaining.size) {
		return;
	}

	for (const fileName of fileNames) {
		const sourceFile = await program.getSourceFile(fileName);
		if (!sourceFile) {
			continue;
		}

		const nodes = collectNamedReferences(sourceFile, remaining);
		if (!nodes.length) {
			continue;
		}

		const symbols = await getSymbols(checker, nodes);
		await addDisallowedSymbols(checker, symbols.filter(isSymbol), disallowedTypes, disallowed);

		for (const type of disallowed.resolvedTypes) {
			remaining.delete(type);
		}

		if (!remaining.size) {
			return;
		}
	}
}

function toViolations(candidates: readonly ICandidate[], symbols: readonly (Symbol | undefined)[], disallowed: IDisallowedSymbols): ILayerViolation[] {
	const violations: ILayerViolation[] = [];

	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i];
		const symbol = symbols[i];
		const disallowedTypes = candidate.rule.disallowedTypes;
		if (!symbol || !disallowedTypes?.length) {
			continue;
		}

		if (disallowedTypes.includes(symbol.name)) {
			violations.push(toViolation(candidate, symbol.name));
			continue;
		}

		const type = disallowed.symbolIds.get(symbol.id);
		if (type && disallowedTypes.includes(type)) {
			violations.push(toViolation(candidate, type));
		}
	}

	return violations;
}

export async function checkProject(project: Project, fileNames: readonly string[], rootPath: string, rules: readonly IRule[]): Promise<ILayerViolation[]> {
	const { program, checker } = project;

	const sourceFiles: { sourceFile: SourceFile; rule: IRule }[] = [];
	const otherFileNames: string[] = [];
	for (const fileName of fileNames) {
		const rule = getRule(fileName, rootPath, rules);
		if (!rule || rule.skip) {
			otherFileNames.push(fileName);
			continue;
		}

		const sourceFile = await program.getSourceFile(fileName);
		if (sourceFile) {
			sourceFiles.push({ sourceFile, rule });
		}
	}

	const disallowedTypes = new Set(rules.flatMap(rule => rule.disallowedTypes ?? []));
	const namedCandidates: ICandidate[] = [];
	for (const { sourceFile, rule } of sourceFiles) {
		for (const node of collectNamedReferences(sourceFile, disallowedTypes)) {
			namedCandidates.push({ node, sourceFile, rule });
		}
	}

	const disallowed: IDisallowedSymbols = { symbolIds: new Map(), memberNames: new Set(), resolvedTypes: new Set() };
	const namedSymbols = await getSymbols(checker, namedCandidates.map(candidate => candidate.node));
	await addDisallowedSymbols(checker, namedSymbols.filter(isSymbol), disallowedTypes, disallowed);
	await resolveRemainingTypes(program, checker, otherFileNames, disallowedTypes, disallowed);

	const memberCandidates: ICandidate[] = [];
	for (const { sourceFile, rule } of sourceFiles) {
		if (!rule.disallowedTypes?.length) {
			continue;
		}

		for (const node of collectMemberReferences(sourceFile, disallowed.memberNames)) {
			memberCandidates.push({ node, sourceFile, rule });
		}
	}

	const memberSymbols = await getSymbols(checker, memberCandidates.map(candidate => candidate.node));

	return [
		...toViolations(namedCandidates, namedSymbols, disallowed),
		...toViolations(memberCandidates, memberSymbols, disallowed),
	];
}

export async function checkLayers(tsconfigPath: string, rules: readonly IRule[]): Promise<ILayerViolation[]> {
	const rootPath = resolve(dirname(tsconfigPath));
	const api = new API({ cwd: rootPath });

	try {
		const { fileNames } = await api.parseConfigFile(tsconfigPath);
		const snapshot = await api.updateSnapshot({ openProjects: [tsconfigPath] });

		const project = snapshot.getProject(tsconfigPath);
		if (!project) {
			throw new Error(`Unable to load a project from '${tsconfigPath}'.`);
		}

		return await checkProject(project, fileNames, rootPath, rules);
	} finally {
		await api.close();
	}
}

export async function runLayerChecker(tsconfigPath: string, rules: readonly IRule[]): Promise<number> {
	const violations = await checkLayers(tsconfigPath, rules);

	for (const violation of violations) {
		console.log(`[build/checker/layersChecker.ts]: Reference to type '${violation.type}' violates layer '${violation.target}' (${violation.fileName}:${violation.line}:${violation.character}). Learn more about our source code organization at https://github.com/microsoft/vscode/wiki/Source-Code-Organization.`);
	}

	return violations.length;
}

if (import.meta.main) {
	process.exitCode = await runLayerChecker(TS_CONFIG_PATH, RULES) ? 1 : 0;
}
