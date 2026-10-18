/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { isEqualOrParent, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceStateFolder } from '../../../../platform/userDataSync/common/userDataSync.js';
import { EditSessionIdentityMatch, IEditSessionIdentityService } from '../../../../platform/workspace/common/editSessions.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';

export const IWorkspaceIdentityService = createDecorator<IWorkspaceIdentityService>('IWorkspaceIdentityService');
export interface IWorkspaceIdentityService {
	_serviceBrand: undefined;
	matches(folders: IWorkspaceStateFolder[], cancellationToken: CancellationToken): Promise<((obj: unknown) => unknown) | false>;
	getWorkspaceStateFolders(cancellationToken: CancellationToken): Promise<IWorkspaceStateFolder[]>;
}

export class WorkspaceIdentityService implements IWorkspaceIdentityService {
	declare _serviceBrand: undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEditSessionIdentityService private readonly editSessionIdentityService: IEditSessionIdentityService
	) { }

	async getWorkspaceStateFolders(cancellationToken: CancellationToken): Promise<IWorkspaceStateFolder[]> {
		const workspaceStateFolders: IWorkspaceStateFolder[] = [];

		for (const workspaceFolder of this.workspaceContextService.getWorkspace().folders) {
			const workspaceFolderIdentity = await this.editSessionIdentityService.getEditSessionIdentifier(workspaceFolder, cancellationToken);
			if (!workspaceFolderIdentity) { continue; }
			workspaceStateFolders.push({ resourceUri: workspaceFolder.uri.toString(), workspaceFolderIdentity });
		}

		return workspaceStateFolders;
	}

	async matches(incomingWorkspaceFolders: IWorkspaceStateFolder[], cancellationToken: CancellationToken): Promise<((value: unknown) => unknown) | false> {
		const incomingToCurrentWorkspaceFolderUris: { [key: string]: string } = {};

		const incomingIdentitiesToIncomingWorkspaceFolders: { [key: string]: string } = {};
		for (const workspaceFolder of incomingWorkspaceFolders) {
			incomingIdentitiesToIncomingWorkspaceFolders[workspaceFolder.workspaceFolderIdentity] = workspaceFolder.resourceUri;
		}

		const currentWorkspaceFoldersToIdentities = new Map<IWorkspaceFolder, string>();
		for (const workspaceFolder of this.workspaceContextService.getWorkspace().folders) {
			const workspaceFolderIdentity = await this.editSessionIdentityService.getEditSessionIdentifier(workspaceFolder, cancellationToken);
			if (!workspaceFolderIdentity) { continue; }
			currentWorkspaceFoldersToIdentities.set(workspaceFolder, workspaceFolderIdentity);
		}

		for (const [currentWorkspaceFolder, currentWorkspaceFolderIdentity] of currentWorkspaceFoldersToIdentities.entries()) {

			const incomingWorkspaceFolder = incomingIdentitiesToIncomingWorkspaceFolders[currentWorkspaceFolderIdentity];
			if (incomingWorkspaceFolder) {
				incomingToCurrentWorkspaceFolderUris[incomingWorkspaceFolder] = currentWorkspaceFolder.uri.toString();
				continue;
			}

			let hasCompleteMatch = false;
			for (const [incomingIdentity, incomingFolder] of Object.entries(incomingIdentitiesToIncomingWorkspaceFolders)) {
				if (await this.editSessionIdentityService.provideEditSessionIdentityMatch(currentWorkspaceFolder, currentWorkspaceFolderIdentity, incomingIdentity, cancellationToken) === EditSessionIdentityMatch.Complete) {
					incomingToCurrentWorkspaceFolderUris[incomingFolder] = currentWorkspaceFolder.uri.toString();
					hasCompleteMatch = true;
					break;
				}
			}

			if (hasCompleteMatch) {
				continue;
			}

			return false;
		}

		const convertUri = (uriToConvert: URI) => {
			for (const incomingFolderUriKey of Object.keys(incomingToCurrentWorkspaceFolderUris)) {
				const incomingFolderUri = URI.parse(incomingFolderUriKey);
				if (isEqualOrParent(incomingFolderUri, uriToConvert)) {
					const currentWorkspaceFolderUri = incomingToCurrentWorkspaceFolderUris[incomingFolderUriKey];

					const relativeFilePath = relativePath(incomingFolderUri, uriToConvert);

					if (relativeFilePath) {
						return joinPath(URI.parse(currentWorkspaceFolderUri), relativeFilePath);
					}
				}
			}

			return uriToConvert;
		};

		const uriReplacer = (obj: unknown, depth = 0) => {
			if (!obj || depth > 200) {
				return obj;
			}

			if (obj instanceof VSBuffer || obj instanceof Uint8Array) {
				return obj;
			}

			if (URI.isUri(obj)) {
				return convertUri(obj);
			}

			if (Array.isArray(obj)) {
				for (let i = 0; i < obj.length; ++i) {
					obj[i] = uriReplacer(obj[i], depth + 1);
				}
			} else {
				for (const key in obj) {
					if (Object.hasOwnProperty.call(obj, key)) {
						(obj as Record<string, unknown>)[key] = uriReplacer((obj as Record<string, unknown>)[key], depth + 1);
					}
				}
			}

			return obj;
		};

		return uriReplacer;
	}
}

registerSingleton(IWorkspaceIdentityService, WorkspaceIdentityService, InstantiationType.Delayed);
