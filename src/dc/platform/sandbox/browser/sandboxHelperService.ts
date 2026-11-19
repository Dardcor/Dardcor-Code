/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { ISandboxDependencyStatus, ISandboxHelperService, type IWindowsMxcConfig, IWindowsMxcFilesystemPolicy, type IWindowsMxcPolicyContainment, type IWindowsMxcSandboxPolicy } from '../common/sandboxHelperService.js';

class NullSandboxHelperService implements ISandboxHelperService {
	declare readonly _serviceBrand: undefined;

	async checkSandboxDependencies(): Promise<ISandboxDependencyStatus> {
		return {
			bubblewrapInstalled: true,
			bubblewrapUsable: true,
			socatInstalled: true,
		};
	}

	async getWindowsMxcFilesystemPolicy(): Promise<IWindowsMxcFilesystemPolicy | undefined> {
		return undefined;
	}

	async getWindowsMxcEnvironment(): Promise<string[] | undefined> {
		return undefined;
	}

	async buildWindowsMxcSandboxPayload(_commandLine: string, _policy: IWindowsMxcSandboxPolicy, _workingDirectory?: string, _containerName?: string, _containment?: IWindowsMxcPolicyContainment): Promise<IWindowsMxcConfig | undefined> {
		return undefined;
	}
}

registerSingleton(ISandboxHelperService, NullSandboxHelperService, InstantiationType.Delayed);
