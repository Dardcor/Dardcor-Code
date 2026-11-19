/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { hash } from '../../../../base/common/hash.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename, dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../files/common/files.js';
import { IAgentPluginManager } from '../../common/agentPluginManager.js';
import { customizationId, type ClientPluginCustomization } from '../../common/state/sessionState.js';
import { CustomizationType, type URI as ProtocolURI } from '../../common/state/protocol/state.js';
import { DiscoveredType, type IDiscoveredDirectory } from './sessionDiscoveryTypes.js';

const DISPLAY_NAME = 'Dardcor Code Synced Data';
const HOST_DISCOVERY_DIR = 'host-discovery';

const MANIFEST_CONTENT = JSON.stringify({
	name: DISPLAY_NAME,
	description: 'Customization data discovered from this workspace and your home directory',
}, null, '\t');

function pluginDirForType(type: DiscoveredType): string | undefined {
	switch (type) {
		case DiscoveredType.Agent: return 'agents';
		case DiscoveredType.Skill: return 'skills';
		case DiscoveredType.Instruction: return 'rules';
		case DiscoveredType.Hook: return 'hooks';
		case DiscoveredType.AgentInstruction: return undefined;
	}
}

interface IBundleResult {
	readonly ref: ClientPluginCustomization;
}

export class SessionPluginBundler extends Disposable {

	private readonly _rootUri: URI;
	private _lastNonce: string | undefined;

	constructor(
		workingDirectory: URI,
		@IFileService private readonly _fileService: IFileService,
		@IAgentPluginManager pluginManager: IAgentPluginManager,
	) {
		super();
		const authority = `host-${hash(workingDirectory.toString())}`;
		this._rootUri = URI.joinPath(pluginManager.basePath, HOST_DISCOVERY_DIR, authority);
	}

	get rootUri(): URI {
		return this._rootUri;
	}

	get lastNonce(): string | undefined {
		return this._lastNonce;
	}

	async bundle(directories: readonly IDiscoveredDirectory[], token: CancellationToken = CancellationToken.None): Promise<IBundleResult | undefined> {
		if (directories.length === 0 || token.isCancellationRequested) {
			return undefined;
		}

		const hashParts: string[] = [];
		const files: { readonly destUri: URI; readonly content: VSBuffer }[] = [];

		for (const discoveredDirectory of directories) {
			const dir = pluginDirForType(discoveredDirectory.type);
			if (!dir) {
				continue;
			}
			for (const file of discoveredDirectory.files) {
				const fileUri = file.uri;
				const fileName = basename(fileUri);

				let destUri: URI;
				let hashKey: string;
				if (discoveredDirectory.type === DiscoveredType.Skill) {
					const skillDirName = basename(dirname(fileUri));
					destUri = URI.joinPath(this._rootUri, dir, skillDirName, fileName);
					hashKey = `${dir}/${skillDirName}/${fileName}`;
				} else {
					destUri = URI.joinPath(this._rootUri, dir, fileName);
					hashKey = `${dir}/${fileName}`;
				}

				const content = await this._fileService.readFile(fileUri);
				if (token.isCancellationRequested) {
					return undefined;
				}
				files.push({ destUri, content: content.value });
				hashParts.push(`${hashKey}:${content.value.toString()}`);
			}
		}
		if (token.isCancellationRequested) {
			return undefined;
		}

		hashParts.sort();
		const nonce = String(hash(hashParts.join('\n')));

		const rootUriString = this._rootUri.toString() as ProtocolURI;
		const result = {
			ref: {
				type: CustomizationType.Plugin,
				id: customizationId(rootUriString),
				uri: rootUriString,
				name: DISPLAY_NAME,
				nonce,
			},
		} satisfies IBundleResult;

		if (this._lastNonce === nonce) {
			return result;
		}

		try {
			await this._fileService.del(this._rootUri, { recursive: true });
		} catch {
		}
		if (token.isCancellationRequested) {
			return undefined;
		}

		const manifestUri = URI.joinPath(this._rootUri, '.plugin', 'plugin.json');
		await this._fileService.createFolder(dirname(manifestUri));
		if (token.isCancellationRequested) {
			return undefined;
		}
		await this._fileService.writeFile(manifestUri, VSBuffer.fromString(MANIFEST_CONTENT));
		if (token.isCancellationRequested) {
			return undefined;
		}

		for (const file of files) {
			await this._fileService.createFolder(dirname(file.destUri));
			if (token.isCancellationRequested) {
				return undefined;
			}
			await this._fileService.writeFile(file.destUri, file.content);
			if (token.isCancellationRequested) {
				return undefined;
			}
		}

		this._lastNonce = nonce;
		return result;
	}
}
