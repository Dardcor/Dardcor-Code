/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isValidBasename } from '../../../../base/common/extpath.js';
import { Schemas } from '../../../../base/common/network.js';
import { IPath, win32, posix } from '../../../../base/common/path.js';
import { OperatingSystem, OS } from '../../../../base/common/platform.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { getVirtualWorkspaceScheme } from '../../../../platform/workspace/common/virtualWorkspace.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { IRemoteAgentService } from '../../remote/common/remoteAgentService.js';

export const IPathService = createDecorator<IPathService>('pathService');

export interface IPathService {

	readonly _serviceBrand: undefined;

	readonly path: Promise<IPath>;

	readonly defaultUriScheme: string;

	fileURI(path: string): Promise<URI>;

	userHome(options: { preferLocal: true }): URI;
	userHome(options?: { preferLocal: boolean }): Promise<URI>;

	hasValidBasename(resource: URI, basename?: string): Promise<boolean>;
	hasValidBasename(resource: URI, os: OperatingSystem, basename?: string): boolean;

	readonly resolvedUserHome: URI | undefined;
}

export abstract class AbstractPathService implements IPathService {

	declare readonly _serviceBrand: undefined;

	private resolveOS: Promise<OperatingSystem>;

	private resolveUserHome: Promise<URI>;
	private maybeUnresolvedUserHome: URI | undefined;

	constructor(
		private localUserHome: URI,
		@IRemoteAgentService private readonly remoteAgentService: IRemoteAgentService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService
	) {

		this.resolveOS = (async () => {
			const env = await this.remoteAgentService.getEnvironment();

			return env?.os || OS;
		})();

		this.resolveUserHome = (async () => {
			const env = await this.remoteAgentService.getEnvironment();
			const userHome = this.maybeUnresolvedUserHome = env?.userHome ?? localUserHome;

			return userHome;
		})();
	}

	hasValidBasename(resource: URI, basename?: string): Promise<boolean>;
	hasValidBasename(resource: URI, os: OperatingSystem, basename?: string): boolean;
	hasValidBasename(resource: URI, arg2?: string | OperatingSystem, basename?: string): boolean | Promise<boolean> {

		if (typeof arg2 === 'string' || typeof arg2 === 'undefined') {
			return this.resolveOS.then(os => this.doHasValidBasename(resource, os, arg2));
		}

		return this.doHasValidBasename(resource, arg2, basename);
	}

	private doHasValidBasename(resource: URI, os: OperatingSystem, name?: string): boolean {

		if (resource.scheme === Schemas.file || resource.scheme === Schemas.vscodeRemote) {
			return isValidBasename(name ?? basename(resource), os === OperatingSystem.Windows);
		}

		return true;
	}

	get defaultUriScheme(): string {
		return AbstractPathService.findDefaultUriScheme(this.environmentService, this.contextService);
	}

	static findDefaultUriScheme(environmentService: IWorkbenchEnvironmentService, contextService: IWorkspaceContextService): string {
		if (environmentService.remoteAuthority) {
			return Schemas.vscodeRemote;
		}

		const virtualWorkspace = getVirtualWorkspaceScheme(contextService.getWorkspace());
		if (virtualWorkspace) {
			return virtualWorkspace;
		}

		const firstFolder = contextService.getWorkspace().folders[0];
		if (firstFolder) {
			return firstFolder.uri.scheme;
		}

		const configuration = contextService.getWorkspace().configuration;
		if (configuration) {
			return configuration.scheme;
		}

		return Schemas.file;
	}

	userHome(options?: { preferLocal: boolean }): Promise<URI>;
	userHome(options: { preferLocal: true }): URI;
	userHome(options?: { preferLocal: boolean }): Promise<URI> | URI {
		return options?.preferLocal ? this.localUserHome : this.resolveUserHome;
	}

	get resolvedUserHome(): URI | undefined {
		return this.maybeUnresolvedUserHome;
	}

	get path(): Promise<IPath> {
		return this.resolveOS.then(os => {
			return os === OperatingSystem.Windows ?
				win32 :
				posix;
		});
	}

	async fileURI(_path: string): Promise<URI> {
		let authority = '';

		const os = await this.resolveOS;
		if (os === OperatingSystem.Windows) {
			_path = _path.replace(/\\/g, '/');
		}

		if (_path[0] === '/' && _path[1] === '/') {
			const idx = _path.indexOf('/', 2);
			if (idx === -1) {
				authority = _path.substring(2);
				_path = '/';
			} else {
				authority = _path.substring(2, idx);
				_path = _path.substring(idx) || '/';
			}
		}

		return URI.from({
			scheme: Schemas.file,
			authority,
			path: _path,
			query: '',
			fragment: ''
		});
	}
}
