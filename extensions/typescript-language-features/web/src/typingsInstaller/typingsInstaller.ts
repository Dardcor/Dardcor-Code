/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/





















import { PackageManager, PackageType } from '@vscode/ts-package-manager';
import { join } from 'path';
import * as ts from 'typescript/lib/tsserverlibrary';
import { NameValidationResult, validatePackageNameWorker } from './jsTyping';

type InstallerResponse = ts.server.PackageInstalledResponse | ts.server.SetTypings | ts.server.InvalidateCachedTypings | ts.server.BeginInstallTypes | ts.server.EndInstallTypes | ts.server.WatchTypingLocations;

export class WebTypingsInstallerClient implements ts.server.ITypingsInstaller {

	private projectService: ts.server.ProjectService | undefined;

	private requestedRegistry = false;

	private typesRegistryCache = new Map<string, ts.MapLike<string>>();

	private readonly server: Promise<WebTypingsInstallerServer>;

	constructor(
		private readonly fs: ts.server.ServerHost,
		readonly globalTypingsCacheLocation: string,
	) {
		this.server = WebTypingsInstallerServer.initialize(
			(response: InstallerResponse) => this.handleResponse(response),
			this.fs,
			globalTypingsCacheLocation
		);
	}

	private async handleResponse(response: InstallerResponse): Promise<void> {
		switch (response.kind) {
			case 'action::packageInstalled':
			case 'action::invalidate':
			case 'action::set':
				this.projectService!.updateTypingsForProject(response);
				break;
			case 'event::beginInstallTypes':
			case 'event::endInstallTypes':
			case 'action::watchTypingLocations':
				break;
			default:
				throw new Error(`unexpected response: ${JSON.stringify(response)}`);
		}
	}

	async installPackage(_options: ts.server.InstallPackageOptionsWithProject): Promise<ts.ApplyCodeActionCommandResult> {
		throw new Error('not implemented');
	}

	isKnownTypesPackageName(packageName: string): boolean {
		console.log('isKnownTypesPackageName', packageName);
		const looksLikeValidName = validatePackageNameWorker(packageName, true);
		if (looksLikeValidName.result !== NameValidationResult.Ok) {
			return false;
		}

		if (this.requestedRegistry) {
			return !!this.typesRegistryCache && this.typesRegistryCache.has(packageName);
		}

		this.requestedRegistry = true;
		this.server.then(s => this.typesRegistryCache = s.typesRegistry);
		return false;
	}

	enqueueInstallTypingsRequest(p: ts.server.Project, typeAcquisition: ts.TypeAcquisition, unresolvedImports: ts.SortedReadonlyArray<string>): void {
		console.log('enqueueInstallTypingsRequest', typeAcquisition, unresolvedImports);
		const req = ts.server.createInstallTypingsRequest(p, typeAcquisition, unresolvedImports);
		this.server.then(s => s.install(req));
	}

	attach(projectService: ts.server.ProjectService): void {
		this.projectService = projectService;
	}

	onProjectClosed(_projectService: ts.server.Project): void {
	}
}

class WebTypingsInstallerServer extends ts.server.typingsInstaller.TypingsInstaller {

	private static readonly typesRegistryPackageName = 'types-registry';

	private constructor(
		override typesRegistry: Map<string, ts.MapLike<string>>,
		private readonly handleResponse: (response: InstallerResponse) => void,
		fs: ts.server.ServerHost,
		private readonly packageManager: PackageManager,
		globalTypingsCachePath: string,
	) {
		super(fs, globalTypingsCachePath, join(globalTypingsCachePath, 'fakeSafeList') as ts.Path, join(globalTypingsCachePath, 'fakeTypesMapLocation') as ts.Path, Infinity);
	}

	static async initialize(
		handleResponse: (response: InstallerResponse) => void,
		fs: ts.server.ServerHost,
		globalTypingsCachePath: string,
	): Promise<WebTypingsInstallerServer> {
		const pm = new PackageManager(fs);
		const pkgJson = join(globalTypingsCachePath, 'package.json');
		if (!fs.fileExists(pkgJson)) {
			fs.writeFile(pkgJson, '{"private":true}');
		}
		const resolved = await pm.resolveProject(globalTypingsCachePath, {
			addPackages: [this.typesRegistryPackageName]
		});
		await resolved.restore();

		const registry = new Map<string, ts.MapLike<string>>();
		const indexPath = join(globalTypingsCachePath, 'node_modules/types-registry/index.json');
		const index = WebTypingsInstallerServer.readJson(fs, indexPath);
		for (const [packageName, entry] of Object.entries(index.entries)) {
			registry.set(packageName, entry as ts.MapLike<string>);
		}
		console.log('ATA registry loaded');
		return new WebTypingsInstallerServer(registry, handleResponse, fs, pm, globalTypingsCachePath);
	}

	protected override installWorker(requestId: number, packageNames: string[], cwd: string, onRequestCompleted: ts.server.typingsInstaller.RequestCompletedAction): void {
		console.log('installWorker', requestId, cwd);
		(async () => {
			try {
				const resolved = await this.packageManager.resolveProject(cwd, {
					addPackages: packageNames,
					packageType: PackageType.DevDependency
				});
				await resolved.restore();
				onRequestCompleted(true);
			} catch (e) {
				onRequestCompleted(false);
			}
		})();
	}

	protected override sendResponse(response: InstallerResponse): void {
		this.handleResponse(response);
	}

	private static readJson(fs: ts.server.ServerHost, path: string): any {
		const data = fs.readFile(path);
		if (!data) {
			throw new Error('Failed to read file: ' + path);
		}
		return JSON.parse(data.trim());
	}
}
