/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { refineServiceDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IPath } from '../../../../platform/window/common/window.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { URI } from '../../../../base/common/uri.js';

export const IWorkbenchEnvironmentService = refineServiceDecorator<IEnvironmentService, IWorkbenchEnvironmentService>(IEnvironmentService);

export interface IWorkbenchEnvironmentService extends IEnvironmentService {


	readonly logFile: URI;
	readonly windowLogsPath: URI;
	readonly extHostLogsPath: URI;

	readonly extensionEnabledProposedApi?: string[];

	readonly remoteAuthority?: string;
	readonly skipReleaseNotes: boolean;
	readonly skipWelcome: boolean;
	readonly disableWorkspaceTrust: boolean;
	readonly webviewExternalEndpoint: string;

	readonly debugRenderer: boolean;
	readonly logExtensionHostCommunication?: boolean;
	readonly enableSmokeTestDriver?: boolean;
	readonly profDurationMarkers?: string[];

	readonly filesToOpenOrCreate?: IPath[] | undefined;
	readonly filesToDiff?: IPath[] | undefined;
	readonly filesToMerge?: IPath[] | undefined;

}
