/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { OS } from '../../../base/common/platform.js';
import { IFileService } from '../../files/common/files.js';
import { InMemoryFileSystemProvider } from '../../files/common/inMemoryFilesystemProvider.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILabelService } from '../../label/common/label.js';
import { AgentHostFileSystemProvider, type IRemoteFilesystemConnection } from './agentHostFileSystemProvider.js';
import { AGENT_HOST_LABEL_FORMATTER, AGENT_HOST_SCHEME, agentHostLabelFormatter, LOCAL_AGENT_HOST_AUTHORITY } from './agentHostUri.js';

export type { IRemoteFilesystemConnection } from './agentHostFileSystemProvider.js';

export const SYNCED_CUSTOMIZATION_SCHEME = 'vscode-synced-customization';

export const IAgentHostFileSystemService = createDecorator<IAgentHostFileSystemService>('agentHostFileSystemService');

export interface IAgentHostFileSystemService {
	readonly _serviceBrand: undefined;

	registerAuthority(authority: string, connection: IRemoteFilesystemConnection): IDisposable;

	ensureSyncedCustomizationProvider(): void;
}

class AgentHostFileSystemService extends Disposable implements IAgentHostFileSystemService {
	declare readonly _serviceBrand: undefined;

	private readonly _fsProvider: AgentHostFileSystemProvider;
	private _syncedCustomizationProviderRegistered = false;

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@ILabelService labelService: ILabelService,
	) {
		super();

		this._fsProvider = this._register(new AgentHostFileSystemProvider());
		this._register(_fileService.registerProvider(AGENT_HOST_SCHEME, this._fsProvider));

		this._register(labelService.registerFormatter(AGENT_HOST_LABEL_FORMATTER));
		this._register(labelService.registerFormatter(agentHostLabelFormatter(LOCAL_AGENT_HOST_AUTHORITY, OS)));
	}

	registerAuthority(authority: string, connection: IRemoteFilesystemConnection): IDisposable {
		return this._fsProvider.registerAuthority(authority, connection);
	}

	ensureSyncedCustomizationProvider(): void {
		if (!this._syncedCustomizationProviderRegistered) {
			this._syncedCustomizationProviderRegistered = true;
			const provider = this._register(new InMemoryFileSystemProvider());
			this._register(this._fileService.registerProvider(SYNCED_CUSTOMIZATION_SCHEME, provider));
		}
	}
}

registerSingleton(IAgentHostFileSystemService, AgentHostFileSystemService, InstantiationType.Delayed);
