/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { session } from 'electron';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { COI, FileAccess, Schemas, CacheControlheaders, DocumentPolicyheaders } from '../../../base/common/network.js';
import { basename, extname, normalize } from '../../../base/common/path.js';
import { isLinux } from '../../../base/common/platform.js';
import { TernarySearchTree } from '../../../base/common/ternarySearchTree.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { validatedIpcMain } from '../../../base/parts/ipc/electron-main/ipcMain.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { ILogService } from '../../log/common/log.js';
import { IIPCObjectUrl, IProtocolMainService } from './protocol.js';
import { IUserDataProfilesService } from '../../userDataProfile/common/userDataProfile.js';

type ProtocolCallback = { (result: string | Electron.FilePathWithHeaders | { error: number }): void };

export class ProtocolMainService extends Disposable implements IProtocolMainService {

	declare readonly _serviceBrand: undefined;

	private readonly validRoots = TernarySearchTree.forPaths<boolean>(!isLinux);
	private readonly validExtensions = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.mp4', '.otf', '.ttf']);

	constructor(
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IUserDataProfilesService userDataProfilesService: IUserDataProfilesService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		// - storage    : all files in global and workspace storage (https://github.com/microsoft/vscode/issues/116735)
		this.addValidFileRoot(environmentService.appRoot);
		this.addValidFileRoot(environmentService.extensionsPath);
		this.addValidFileRoot(userDataProfilesService.defaultProfile.globalStorageHome.with({ scheme: Schemas.file }).fsPath);
		this.addValidFileRoot(environmentService.workspaceStorageHome.with({ scheme: Schemas.file }).fsPath);

		this.handleProtocols();
	}

	private handleProtocols(): void {
		const { defaultSession } = session;

		defaultSession.protocol.registerFileProtocol(Schemas.vscodeFileResource, (request, callback) => this.handleResourceRequest(request, callback));

		defaultSession.protocol.interceptFileProtocol(Schemas.file, (request, callback) => this.handleFileRequest(request, callback));

		this._register(toDisposable(() => {
			defaultSession.protocol.unregisterProtocol(Schemas.vscodeFileResource);
			defaultSession.protocol.uninterceptProtocol(Schemas.file);
		}));
	}

	addValidFileRoot(root: string): IDisposable {

		const normalizedRoot = normalize(root);

		if (!this.validRoots.get(normalizedRoot)) {
			this.validRoots.set(normalizedRoot, true);

			return toDisposable(() => this.validRoots.delete(normalizedRoot));
		}

		return Disposable.None;
	}


	private handleFileRequest(request: Electron.ProtocolRequest, callback: ProtocolCallback) {
		const uri = URI.parse(request.url);

		this.logService.error(`Refused to load resource ${uri.fsPath} from ${Schemas.file}: protocol (original URL: ${request.url})`);

		return callback({ error: -3 });
	}



	private handleResourceRequest(request: Electron.ProtocolRequest, callback: ProtocolCallback): void {
		const path = this.requestToNormalizedFilePath(request);
		const pathBasename = basename(path);

		let headers: Record<string, string> | undefined;
		if (this.environmentService.crossOriginIsolated) {
			if (pathBasename === 'workbench.html' || pathBasename === 'workbench-dev.html') {
				headers = COI.CoopAndCoep;
			} else {
				headers = COI.getHeadersFromQuery(request.url);
			}
		}

		if (!this.environmentService.isBuilt) {
			headers = {
				...headers,
				...CacheControlheaders
			};
		}

		if (pathBasename === 'workbench.html' || pathBasename === 'workbench-dev.html') {
			headers = {
				...headers,
				...DocumentPolicyheaders
			};
		}

		if (this.validRoots.findSubstr(path)) {
			return callback({ path, headers });
		}

		if (this.validExtensions.has(extname(path).toLowerCase())) {
			return callback({ path, headers });
		}

		this.logService.error(`${Schemas.vscodeFileResource}: Refused to load resource ${path} from ${Schemas.vscodeFileResource}: protocol (original URL: ${request.url})`);

		return callback({ error: -3 });
	}

	private requestToNormalizedFilePath(request: Electron.ProtocolRequest): string {

		const requestUri = URI.parse(request.url);

		const unnormalizedFileUri = FileAccess.uriToFileUri(requestUri);

		return normalize(unnormalizedFileUri.fsPath);
	}



	createIPCObjectUrl<T>(): IIPCObjectUrl<T> {
		let obj: T | undefined = undefined;

		const resource = URI.from({
			scheme: 'vscode',
			path: generateUuid()
		});

		const channel = resource.toString();
		const handler = async (): Promise<T | undefined> => obj;
		validatedIpcMain.handle(channel, handler);

		this.logService.trace(`IPC Object URL: Registered new channel ${channel}.`);

		return {
			resource,
			update: updatedObj => obj = updatedObj,
			dispose: () => {
				this.logService.trace(`IPC Object URL: Removed channel ${channel}.`);

				validatedIpcMain.removeHandler(channel);
			}
		};
	}

}
