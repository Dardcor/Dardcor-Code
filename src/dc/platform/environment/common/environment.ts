/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { NativeParsedArgs } from './argv.js';
import { createDecorator, refineServiceDecorator } from '../../instantiation/common/instantiation.js';

export const IEnvironmentService = createDecorator<IEnvironmentService>('environmentService');
export const INativeEnvironmentService = refineServiceDecorator<IEnvironmentService, INativeEnvironmentService>(IEnvironmentService);

export interface IDebugParams {
	port: number | null;
	break: boolean;
}

export interface IExtensionHostDebugParams extends IDebugParams {
	debugId?: string;
	env?: Record<string, string>;
}

export type ExtensionKind = 'ui' | 'workspace' | 'web';

export interface IEnvironmentService {

	readonly _serviceBrand: undefined;


	stateResource: URI;
	userRoamingDataHome: URI;
	keyboardLayoutResource: URI;
	argvResource: URI;

	untitledWorkspacesHome: URI;
	workspaceStorageHome: URI;
	localHistoryHome: URI;
	cacheHome: URI;
	appSharedDataHome: URI;

	userDataSyncHome: URI;
	sync: 'on' | 'off' | undefined;

	continueOn?: string;
	editSessionId?: string;

	debugExtensionHost: IExtensionHostDebugParams;
	isExtensionDevelopment: boolean;
	disableExtensions: boolean | string[];
	skipBuiltinExtensions?: readonly string[];
	enableExtensions?: readonly string[];
	extensionDevelopmentLocationURI?: URI[];
	extensionDevelopmentKind?: ExtensionKind[];
	extensionTestsLocationURI?: URI;

	logsHome: URI;
	logLevel?: string;
	extensionLogLevel?: [string, string][];
	verbose: boolean;
	isBuilt: boolean;

	disableTelemetry: boolean;
	disableExperiments: boolean;
	serviceMachineIdResource: URI;

	policyFile?: URI;

}

export interface INativeEnvironmentService extends IEnvironmentService {


	args: NativeParsedArgs;

	appRoot: string;
	userHome: URI;
	appSettingsHome: URI;
	tmpDir: URI;
	userDataPath: string;

	extensionsPath: string;
	extensionsDownloadLocation: URI;
	builtinExtensionsPath: string;

	useInMemorySecretStorage?: boolean;

	crossOriginIsolated?: boolean;
	exportPolicyData?: string;
	exportDefaultKeybindings?: string;

}
