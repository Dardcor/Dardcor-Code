/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import * as fs from 'fs';
import { glob } from 'glob';
import * as jsonc from 'jsonc-parser';
import * as path from 'path';
import { promisify } from 'util';

const REPO_ROOT = path.join(__dirname, '..', '..');
const CHAT_LIB_DIR = path.join(REPO_ROOT, 'chat-lib');
const TARGET_DIR = path.join(CHAT_LIB_DIR, 'src');
const execAsync = promisify(exec);

const entryPoints = [
	'src/lib/node/chatLibMain.ts',
	'src/util/vs/base-common.d.ts',
	'src/util/vs/vscode-globals-nls.d.ts',
	'src/util/vs/vscode-globals-product.d.ts',
	'src/util/common/globals.d.ts',
	'src/util/common/test/shims/dardcorTypesShim.ts',
	'src/platform/diff/common/diffWorker.ts',
	'src/platform/tokenizer/node/tikTokenizerWorker.ts',
	'src/platform/authentication/test/node/simulationTestDardcorTokenManager.ts',
	'src/extension/completions-core/vscode-node/lib/src/test/textDocument.ts',
];

interface FileInfo {
	srcPath: string;
	destPath: string;
	relativePath: string;
	dependencies: string[];
}

class ChatLibExtractor {
	private processedFiles = new Set<string>();
	private allFiles = new Map<string, FileInfo>();
	private pathMappings: Map<string, string> = new Map();

	async extract(): Promise<void> {
		await this.loadPathMappings();
		console.log('Starting chat-lib extraction...');

		await this.cleanTargetDir();

		await this.processEntryPoints();

		await this.copyFiles();

		await this.generateModuleFiles();

		await this.validateModule();

		await this.compileTypeScript();

		console.log('Chat-lib extraction completed successfully!');
	}

	private async loadPathMappings(): Promise<void> {
		const tsconfigPath = path.join(REPO_ROOT, 'tsconfig.json');
		const tsconfigContent = await fs.promises.readFile(tsconfigPath, 'utf-8');
		const tsconfig = jsonc.parse(tsconfigContent);

		if (tsconfig.compilerOptions?.paths) {
			for (const [alias, targets] of Object.entries(tsconfig.compilerOptions.paths)) {
				if (alias === 'vscode') {
					continue;
				}

				if (Array.isArray(targets) && targets.length > 0) {
					const target = targets[0];
					const cleanTarget = target.replace(/^\.\//, '').replace(/\/\*$/, '');
					const cleanAlias = alias.replace(/\/\*$/, '');
					this.pathMappings.set(cleanAlias, cleanTarget);
				}
			}
		}

		console.log('Loaded path mappings:', Array.from(this.pathMappings.entries()));
	}

	private async cleanTargetDir(): Promise<void> {
		if (fs.existsSync(TARGET_DIR)) {
			await fs.promises.rm(TARGET_DIR, { recursive: true, force: true });
		}
		await fs.promises.mkdir(TARGET_DIR, { recursive: true });
	}

	private async processEntryPoints(): Promise<void> {
		console.log('Processing entry points and dependencies...');

		const testFiles = await glob('src/lib/vscode-node/test/*.ts', { cwd: REPO_ROOT });
		const queue = [...entryPoints, ...testFiles];

		while (queue.length > 0) {
			const filePath = queue.shift()!;
			if (this.processedFiles.has(filePath)) {
				continue;
			}

			const fullPath = path.join(REPO_ROOT, filePath);
			if (!fs.existsSync(fullPath)) {
				console.warn(`Warning: File not found: ${filePath}`);
				continue;
			}

			const dependencies = await this.extractDependencies(fullPath);
			const destPath = this.getDestinationPath(filePath);

			this.allFiles.set(filePath, {
				srcPath: fullPath,
				destPath,
				relativePath: filePath,
				dependencies
			});

			this.processedFiles.add(filePath);

			dependencies.forEach(dep => {
				if (!this.processedFiles.has(dep)) {
					queue.push(dep);
				}
			});
		}
	}

	private async extractDependencies(filePath: string): Promise<string[]> {
		const content = await fs.promises.readFile(filePath, 'utf-8');
		const dependencies: string[] = [];

		const lines = content.split('\n');
		const activeLines: string[] = [];
		let inBlockComment = false;

		for (const line of lines) {
			if (line.trim().startsWith('/*')) {
				if (!(filePath.endsWith('.tsx') && line.match(/\/\*\*\s+@jsxImportSource\s+\S+/))) {
					inBlockComment = true;
				}
			}
			if (inBlockComment) {
				if (line.includes('*/')) {
					inBlockComment = false;
				}
				continue;
			}

			const trimmedLine = line.trim();
			if (trimmedLine.startsWith('//')) {
				continue;
			}

			let processedLine = line;
			if (trimmedLine.includes('import') || trimmedLine.includes('export')) {
				const commentIndex = line.indexOf('//');
				if (commentIndex !== -1) {
					const beforeComment = line.substring(0, commentIndex);
					const singleQuotes = (beforeComment.match(/'/g) || []).length;
					const doubleQuotes = (beforeComment.match(/"/g) || []).length;
					if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
						processedLine = beforeComment;
					}
				}
			}

			activeLines.push(processedLine);
		}

		const activeContent = activeLines.join('\n');

		const relativeImportRegex = /(?:import(?:\s+type)?|export)\s+(?:(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+)\s+from\s+)?['"](\.\.?\/[^'"]*)['"]/g;
		let match;

		while ((match = relativeImportRegex.exec(activeContent)) !== null) {
			const importPath = match[1];
			const resolvedPath = this.resolveImportPath(filePath, importPath);

			if (resolvedPath) {
				dependencies.push(resolvedPath);
			}
		}

		const aliasImportRegex = /(?:import(?:\s+type)?|export)\s+(?:(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+)\s+from\s+)?['"]([#][^'"]*)['"]/g;

		while ((match = aliasImportRegex.exec(activeContent)) !== null) {
			const importPath = match[1];
			const resolvedPath = this.resolvePathAlias(importPath);

			if (resolvedPath) {
				dependencies.push(resolvedPath);
			}
		}

		if (filePath.endsWith('.tsx')) {
			const jsxRelativeImportRegex = /\/\*\*\s+@jsxImportSource\s+(\.\.?\/\S+)\s+\*\//g;

			while ((match = jsxRelativeImportRegex.exec(activeContent)) !== null) {
				const importPath = match[1];
				const resolvedPath = this.resolveImportPath(filePath, path.join(importPath, 'jsx-runtime'));

				if (resolvedPath) {
					dependencies.push(resolvedPath);
				}

				const resolvedDevPath = this.resolveImportPath(filePath, path.join(importPath, 'jsx-dev-runtime'));

				if (resolvedDevPath) {
					dependencies.push(resolvedDevPath);
				}
			}
		}

		return dependencies;
	}

	private resolvePathAlias(importPath: string): string | null {
		for (const [alias, targetPath] of this.pathMappings.entries()) {
			if (importPath === alias) {
				return this.resolveFileWithExtensions(path.join(REPO_ROOT, targetPath));
			} else if (importPath.startsWith(alias + '/')) {
				const remainder = importPath.substring(alias.length + 1);
				const fullPath = path.join(REPO_ROOT, targetPath, remainder);
				return this.resolveFileWithExtensions(fullPath);
			}
		}

		console.warn(`Warning: Path alias not found for: ${importPath}`);
		return null;
	}

	private resolveFileWithExtensions(basePath: string): string | null {
		if (fs.existsSync(basePath + '.ts')) {
			return this.normalizePath(path.relative(REPO_ROOT, basePath + '.ts'));
		}

		if (fs.existsSync(basePath + '.tsx')) {
			return this.normalizePath(path.relative(REPO_ROOT, basePath + '.tsx'));
		}

		if (fs.existsSync(basePath + '.d.ts')) {
			return this.normalizePath(path.relative(REPO_ROOT, basePath + '.d.ts'));
		}

		if (fs.existsSync(path.join(basePath, 'index.ts'))) {
			return this.normalizePath(path.relative(REPO_ROOT, path.join(basePath, 'index.ts')));
		}

		if (fs.existsSync(path.join(basePath, 'index.tsx'))) {
			return this.normalizePath(path.relative(REPO_ROOT, path.join(basePath, 'index.tsx')));
		}

		if (fs.existsSync(path.join(basePath, 'index.d.ts'))) {
			return this.normalizePath(path.relative(REPO_ROOT, path.join(basePath, 'index.d.ts')));
		}

		if (fs.existsSync(basePath)) {
			return this.normalizePath(path.relative(REPO_ROOT, basePath));
		}

		return null;
	}

	private resolveImportPath(fromFile: string, importPath: string): string | null {
		const fromDir = path.dirname(fromFile);
		const resolved = path.resolve(fromDir, importPath);

		if (importPath.endsWith('.js')) {
			const baseResolved = resolved.slice(0, -3);
			if (fs.existsSync(baseResolved + '.ts')) {
				return this.normalizePath(path.relative(REPO_ROOT, baseResolved + '.ts'));
			}
			if (fs.existsSync(baseResolved + '.tsx')) {
				return this.normalizePath(path.relative(REPO_ROOT, baseResolved + '.tsx'));
			}
		}

		if (fs.existsSync(resolved + '.ts')) {
			return this.normalizePath(path.relative(REPO_ROOT, resolved + '.ts'));
		}

		if (fs.existsSync(resolved + '.tsx')) {
			return this.normalizePath(path.relative(REPO_ROOT, resolved + '.tsx'));
		}

		if (fs.existsSync(resolved + '.d.ts')) {
			return this.normalizePath(path.relative(REPO_ROOT, resolved + '.d.ts'));
		}

		if (fs.existsSync(path.join(resolved, 'index.ts'))) {
			return this.normalizePath(path.relative(REPO_ROOT, path.join(resolved, 'index.ts')));
		}

		if (fs.existsSync(path.join(resolved, 'index.tsx'))) {
			return this.normalizePath(path.relative(REPO_ROOT, path.join(resolved, 'index.tsx')));
		}

		if (fs.existsSync(path.join(resolved, 'index.d.ts'))) {
			return this.normalizePath(path.relative(REPO_ROOT, path.join(resolved, 'index.d.ts')));
		}

		if (fs.existsSync(resolved)) {
			return this.normalizePath(path.relative(REPO_ROOT, resolved));
		}

		throw new Error(`Import file not found: ${importPath} (resolved to ${resolved}) imported from ${fromFile}`);
	}

	private normalizePath(filePath: string): string {
		return filePath.replace(/\\/g, '/');
	}

	private getDestinationPath(filePath: string): string {
		const normalizedPath = this.normalizePath(filePath);
		const relativePath = normalizedPath.replace(/^src\//, '_internal/');
		return path.join(TARGET_DIR, relativePath);
	}

	private async copyFiles(): Promise<void> {
		console.log(`Copying ${this.allFiles.size} files...`);

		for (const [, fileInfo] of this.allFiles) {
			if (fileInfo.relativePath === 'src/lib/node/chatLibMain.ts') {
				continue;
			}

			await fs.promises.mkdir(path.dirname(fileInfo.destPath), { recursive: true });
			const content = await fs.promises.readFile(fileInfo.srcPath, 'utf-8');

			const transformedContent = this.transformFileContent(content, fileInfo.relativePath);

			await fs.promises.writeFile(fileInfo.destPath, transformedContent);
		}
	}



	private transformFileContent(content: string, filePath: string): string {
		let transformed = content;

		const normalizedFilePath = this.normalizePath(filePath);

		transformed = this.rewriteVscodeImports(transformed, normalizedFilePath);

		transformed = this.rewriteVscodeTypesImports(transformed, normalizedFilePath);

		if (normalizedFilePath.startsWith('src/lib/vscode-node/test/')) {
			transformed = transformed.replace(
				/(from\s+['"])\.\.\/\.\.\/node\/chatLibMain(['"])/g,
				'$1../../../../main$2'
			);
		}

		if (normalizedFilePath === 'src/lib/node/chatLibMain.ts') {
			transformed = transformed.replace(
				/import\s+([^'"]*)\s+from\s+['"](\.\/[^'"]*|\.\.\/[^'"]*)['"]/g,
				(match, importClause, importPath) => {
					const rewrittenPath = this.rewriteImportPath(filePath, importPath);
					return `import ${importClause} from '${rewrittenPath}'`;
				}
			);
		}

		return transformed;
	}

	private rewriteVscodeImports(content: string, filePath: string): string {
		if (filePath === 'src/vscodeTypes.ts') {
			return content;
		}

		const vscodeImportRegex = /^(\s*import\s+)(?!type\s+)([^'"]*)\s+from\s+['"]vscode['"];?\s*$/gm;

		return content.replace(vscodeImportRegex, (match, importPrefix, importClause) => {
			const shimPath = this.getVscodeTypesShimPath(filePath);
			return `${importPrefix}${importClause.trim()} from '${shimPath}';`;
		});
	}

	private rewriteVscodeTypesImports(content: string, filePath: string): string {
		if (filePath === 'src/vscodeTypes.ts') {
			return content;
		}

		if (filePath === 'src/util/common/test/shims/dardcorTypesShim.ts') {
			return content;
		}

		const vscodeTypesImportRegex = /^(\s*import\s+)(?!type\s+)([^'"]*)\s+from\s+['"]([^'"]*\/vscodeTypes)['"];?\s*$/gm;

		return content.replace(vscodeTypesImportRegex, (match, importPrefix, importClause, importPath) => {
			const shimPath = this.getVscodeTypesShimPath(filePath);
			return `${importPrefix}${importClause.trim()} from '${shimPath}';`;
		});
	}

	private getVscodeTypesShimPath(filePath: string): string {
		if (filePath === 'src/lib/node/chatLibMain.ts') {
			return './_internal/util/common/test/shims/dardcorTypesShim';
		}


		const relativePath = filePath.replace(/^src\//, '');
		const pathSegments = relativePath.split('/');
		const depth = pathSegments.length - 1;

		const upLevels = '../'.repeat(depth);
		return `${upLevels}util/common/test/shims/dardcorTypesShim`;
	}

	private rewriteImportPath(fromFile: string, importPath: string): string {
		if (fromFile === 'src/lib/node/chatLibMain.ts') {
			return importPath.replace(/^\.\.\/\.\.\//, './_internal/');
		}

		return importPath;
	}

	private async generateModuleFiles(): Promise<void> {
		console.log('Using static module files already present in chat-lib directory...');

		const mainTsPath = path.join(REPO_ROOT, 'src', 'lib', 'node', 'chatLibMain.ts');
		const mainTsContent = await fs.promises.readFile(mainTsPath, 'utf-8');
		const transformedMainTs = this.transformFileContent(mainTsContent, 'src/lib/node/chatLibMain.ts');
		await fs.promises.writeFile(path.join(TARGET_DIR, 'main.ts'), transformedMainTs);

		await this.copyRootPackageJson();

		await this.copyVSCodeProposedTypes();

		await this.copyTikTokenFiles();

		await this.copyTestReplyFiles();

		await this.updateChatLibTsConfig();
	}

	private async copyTestReplyFiles(): Promise<void> {
		console.log('Copying test reply files...');

		const testDir = path.join(REPO_ROOT, 'src', 'lib', 'vscode-node', 'test');
		const replyFiles = await glob('*.reply.txt', { cwd: testDir });

		for (const file of replyFiles) {
			const srcPath = path.join(testDir, file);
			const destPath = path.join(TARGET_DIR, '_internal', 'lib', 'vscode-node', 'test', file);

			await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
			await fs.promises.copyFile(srcPath, destPath);
		}

		console.log(`Copied ${replyFiles.length} test reply files`);
	}

	private async updateChatLibTsConfig(): Promise<void> {
		console.log('Updating chat-lib tsconfig.json with path mappings...');

		const chatLibTsconfigPath = path.join(CHAT_LIB_DIR, 'tsconfig.json');
		const tsconfigContent = await fs.promises.readFile(chatLibTsconfigPath, 'utf-8');
		const tsconfig = jsonc.parse(tsconfigContent);

		if (!tsconfig.compilerOptions) {
			tsconfig.compilerOptions = {};
		}

		if (!tsconfig.compilerOptions.paths) {
			tsconfig.compilerOptions.paths = {};
		}

		const rootTsconfigPath = path.join(REPO_ROOT, 'tsconfig.json');
		const rootTsconfigContent = await fs.promises.readFile(rootTsconfigPath, 'utf-8');
		const rootTsconfig = jsonc.parse(rootTsconfigContent);

		for (const [alias, targetPath] of this.pathMappings.entries()) {
			const pathWithoutSrc = targetPath.replace(/^src\//, '');
			const chatLibPath = `./src/_internal/${pathWithoutSrc}`;

			let aliasWithWildcard = alias;
			let pathWithWildcard = chatLibPath;

			if (rootTsconfig.compilerOptions?.paths) {
				for (const key of Object.keys(rootTsconfig.compilerOptions.paths)) {
					const keyWithoutWildcard = key.replace(/\/\*$/, '');
					if (keyWithoutWildcard === alias && key.endsWith('/*')) {
						aliasWithWildcard = alias + '/*';
						pathWithWildcard = chatLibPath + '/*';
						break;
					}
				}
			}

			tsconfig.compilerOptions.paths[aliasWithWildcard] = [pathWithWildcard];
		}

		await fs.promises.writeFile(
			chatLibTsconfigPath,
			JSON.stringify(tsconfig, null, '\t') + '\n'
		);

		console.log('Chat-lib tsconfig.json updated with path mappings:', Object.keys(tsconfig.compilerOptions.paths));
	}

	private async validateModule(): Promise<void> {
		console.log('Validating module...');

		const staticFiles = ['package.json', 'tsconfig.json', 'README.md', 'LICENSE.txt'];
		for (const file of staticFiles) {
			const filePath = path.join(CHAT_LIB_DIR, file);
			if (!fs.existsSync(filePath)) {
				throw new Error(`Required static file missing: ${file}`);
			}
		}

		const mainTsPath = path.join(TARGET_DIR, 'main.ts');
		if (!fs.existsSync(mainTsPath)) {
			throw new Error(`Required file missing: src/main.ts`);
		}

		console.log('Module validation passed!');
	}

	private async copyVSCodeProposedTypes(): Promise<void> {
		console.log('Copying vscode*.d.ts files referenced by vscode-api.d.ts...');

		const vscodeApiSrcPath = path.join(REPO_ROOT, 'src', 'extension', 'vscode-api.d.ts');
		if (!fs.existsSync(vscodeApiSrcPath)) {
			throw new Error(`vscode-api.d.ts not found at ${vscodeApiSrcPath}`);
		}

		const content = await fs.promises.readFile(vscodeApiSrcPath, 'utf-8');

		const refRegex = /\/\/\/\s*<reference\s+path="([^"]+)"\s*\/>/g;
		let match;
		const referencedFiles: { refPath: string; fileName: string }[] = [];

		while ((match = refRegex.exec(content)) !== null) {
			const refPath = match[1];
			const fileName = path.basename(refPath);
			referencedFiles.push({ refPath, fileName });
		}

		const vscodeDtsDestDir = path.join(TARGET_DIR, '_internal', 'vscode-dts');
		await fs.promises.mkdir(vscodeDtsDestDir, { recursive: true });

		for (const { refPath, fileName } of referencedFiles) {
			const srcPath = path.resolve(path.dirname(vscodeApiSrcPath), refPath);
			if (!fs.existsSync(srcPath)) {
				console.warn(`Warning: Referenced file not found: ${srcPath}`);
				continue;
			}

			const destPath = path.join(vscodeDtsDestDir, fileName);
			await fs.promises.copyFile(srcPath, destPath);
		}

		const updatedContent = content.replace(
			/\/\/\/\s*<reference\s+path="([^"]+)"\s*\/>/g,
			(_match, refPath: string) => {
				const fileName = path.basename(refPath);
				return `/// <reference path="./vscode-dts/${fileName}" />`;
			}
		);

		const vscodeApiDestPath = path.join(TARGET_DIR, '_internal', 'vscode-api.d.ts');
		await fs.promises.writeFile(vscodeApiDestPath, updatedContent);

		const vscodeRepoRoot = path.join(REPO_ROOT, '..', '..');
		const thenableSrcPath = path.join(vscodeRepoRoot, 'src', 'typings', 'thenable.d.ts');
		if (fs.existsSync(thenableSrcPath)) {
			await fs.promises.copyFile(thenableSrcPath, path.join(vscodeDtsDestDir, 'thenable.d.ts'));
			console.log('Copied thenable.d.ts');
		} else {
			console.warn(`Warning: thenable.d.ts not found at ${thenableSrcPath}`);
		}

		console.log(`Copied vscode-api.d.ts and ${referencedFiles.length} referenced .d.ts files`);
	}

	private async copyTikTokenFiles(): Promise<void> {
		console.log('Copying tiktoken files...');

		const tokenizerDir = path.join(REPO_ROOT, 'src', 'platform', 'tokenizer', 'node');
		const tikTokenFiles = await glob('*.tiktoken', { cwd: tokenizerDir });

		for (const file of tikTokenFiles) {
			const srcPath = path.join(tokenizerDir, file);
			const destPath = path.join(TARGET_DIR, '_internal', 'platform', 'tokenizer', 'node', file);

			await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
			await fs.promises.copyFile(srcPath, destPath);
		}

		console.log(`Copied ${tikTokenFiles.length} tiktoken files`);
	}

	private async copyRootPackageJson(): Promise<void> {
		console.log('Copying root package.json to chat-lib/src...');

		const srcPath = path.join(REPO_ROOT, 'package.json');
		const destPath = path.join(TARGET_DIR, 'package.json');

		await fs.promises.copyFile(srcPath, destPath);
		console.log('Root package.json copied successfully!');

		await this.updateChatLibDependencies();
	}

	private async updateChatLibDependencies(): Promise<void> {
		console.log('Updating chat-lib package.json dependencies...');

		const rootPackageJsonPath = path.join(REPO_ROOT, 'package.json');
		const chatLibPackageJsonPath = path.join(CHAT_LIB_DIR, 'package.json');
		const rootPackageLockPath = path.join(REPO_ROOT, 'package-lock.json');
		const chatLibPackageLockPath = path.join(CHAT_LIB_DIR, 'package-lock.json');

		const rootPackageJson = JSON.parse(await fs.promises.readFile(rootPackageJsonPath, 'utf-8'));
		const chatLibPackageJson = JSON.parse(await fs.promises.readFile(chatLibPackageJsonPath, 'utf-8'));

		const rootDependencies = {
			...(rootPackageJson.dependencies || {}),
			...(rootPackageJson.devDependencies || {})
		};

		let updatedCount = 0;
		let removedCount = 0;
		const changes: string[] = [];
		const updatedPackages = new Set<string>();

		for (const depType of ['dependencies', 'devDependencies']) {
			if (chatLibPackageJson[depType]) {
				const dependencyNames = Object.keys(chatLibPackageJson[depType]);

				for (const depName of dependencyNames) {
					if (rootDependencies[depName]) {
						const oldVersion = chatLibPackageJson[depType][depName];
						const newVersion = rootDependencies[depName];

						if (oldVersion !== newVersion) {
							chatLibPackageJson[depType][depName] = newVersion;
							changes.push(`  Updated ${depName}: ${oldVersion} → ${newVersion}`);
							updatedCount++;
							updatedPackages.add(depName);
						}
					} else {
						delete chatLibPackageJson[depType][depName];
						changes.push(`  Removed ${depName} (no longer in root package.json)`);
						removedCount++;
					}
				}

				if (Object.keys(chatLibPackageJson[depType]).length === 0) {
					delete chatLibPackageJson[depType];
				}
			}
		}

		await fs.promises.writeFile(
			chatLibPackageJsonPath,
			JSON.stringify(chatLibPackageJson, null, '\t') + '\n'
		);

		console.log(`Chat-lib dependencies updated: ${updatedCount} updated, ${removedCount} removed`);
		if (changes.length > 0) {
			console.log('Changes made:');
			changes.forEach(change => console.log(change));
		}

		if (updatedPackages.size > 0 && fs.existsSync(rootPackageLockPath) && fs.existsSync(chatLibPackageLockPath)) {
			console.log('Updating chat-lib package-lock.json for changed dependencies...');

			const rootPackageLock = JSON.parse(await fs.promises.readFile(rootPackageLockPath, 'utf-8'));
			const chatLibPackageLock = JSON.parse(await fs.promises.readFile(chatLibPackageLockPath, 'utf-8'));

			if (chatLibPackageLock.packages && chatLibPackageLock.packages['']) {
				chatLibPackageLock.packages[''].dependencies = chatLibPackageJson.dependencies || {};
				chatLibPackageLock.packages[''].devDependencies = chatLibPackageJson.devDependencies || {};
			}

			const packagesToUpdate = new Set<string>();
			const queue: string[] = [];

			for (const pkgName of updatedPackages) {
				const pkgPath = `node_modules/${pkgName}`;
				queue.push(pkgPath);
				packagesToUpdate.add(pkgPath);
			}

			while (queue.length > 0) {
				const pkgPath = queue.shift()!;
				const pkgInfo = rootPackageLock.packages?.[pkgPath];

				if (pkgInfo) {
					const deps = {
						...pkgInfo.dependencies,
						...pkgInfo.optionalDependencies,
						...pkgInfo.devDependencies
					};

					for (const depName of Object.keys(deps)) {
						const nestedDepPath = `${pkgPath}/node_modules/${depName}`;
						const topLevelDepPath = `node_modules/${depName}`;

						let actualDepPath: string | null = null;
						if (rootPackageLock.packages[nestedDepPath]) {
							actualDepPath = nestedDepPath;
						} else if (rootPackageLock.packages[topLevelDepPath]) {
							actualDepPath = topLevelDepPath;
						} else {
							const pathParts = pkgPath.split('/node_modules/');
							for (let i = pathParts.length - 1; i >= 0; i--) {
								const parentPath = pathParts.slice(0, i).join('/node_modules/');
								const candidatePath = parentPath ? `${parentPath}/node_modules/${depName}` : `node_modules/${depName}`;
								if (rootPackageLock.packages[candidatePath]) {
									actualDepPath = candidatePath;
									break;
								}
							}
						}

						if (actualDepPath && !packagesToUpdate.has(actualDepPath)) {
							packagesToUpdate.add(actualDepPath);
							queue.push(actualDepPath);
						}
					}
				}
			}

			let lockUpdatedCount = 0;
			for (const pkgPath of packagesToUpdate) {
				if (rootPackageLock.packages[pkgPath]) {
					chatLibPackageLock.packages[pkgPath] = rootPackageLock.packages[pkgPath];
					lockUpdatedCount++;
				}
			}

			await fs.promises.writeFile(
				chatLibPackageLockPath,
				JSON.stringify(chatLibPackageLock, null, '\t') + '\n'
			);

			console.log(`Chat-lib package-lock.json updated: ${lockUpdatedCount} package entries updated`);
		}
	}

	private async compileTypeScript(): Promise<void> {
		console.log('Compiling TypeScript to validate module...');

		try {
			const { stdout, stderr } = await execAsync('npx tsc6 --noEmit', {
				cwd: CHAT_LIB_DIR,
				timeout: 60000
			});

			if (stderr) {
				console.warn('TypeScript compilation warnings:', stderr);
			}

			console.log('TypeScript compilation successful!');
		} catch (error: any) {
			console.error('TypeScript compilation failed:', error.stdout || error.message);
			throw new Error(`TypeScript compilation failed: ${error.stdout || error.message}`);
		}
	}
}

async function main(): Promise<void> {
	try {
		const extractor = new ChatLibExtractor();
		await extractor.extract();
	} catch (error) {
		console.error('Extraction failed:', error);
		process.exit(1);
	}
}

if (require.main === module) {
	main();
}
