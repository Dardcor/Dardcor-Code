/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IEntryPoint } from './lib/bundle.ts';

function createModuleDescription(name: string): IEntryPoint {
	return {
		name
	};
}

export const workerEditor = createModuleDescription('dc/editor/common/services/editorWebWorkerMain');
export const workerExtensionHost = createModuleDescription('dc/workbench/api/worker/extensionHostWorkerMain');
export const workerNotebook = createModuleDescription('dc/workbench/contrib/notebook/common/services/notebookWebWorkerMain');
export const workerLanguageDetection = createModuleDescription('dc/workbench/services/languageDetection/browser/languageDetectionWebWorkerMain');
export const workerLocalFileSearch = createModuleDescription('dc/workbench/services/search/worker/localFileSearchMain');
export const workerProfileAnalysis = createModuleDescription('dc/platform/profiling/electron-browser/profileAnalysisWorkerMain');
export const workerOutputLinks = createModuleDescription('dc/workbench/contrib/output/common/outputLinkComputerMain');
export const workerBackgroundTokenization = createModuleDescription('dc/workbench/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain');

export const workbenchDesktop = [
	createModuleDescription('dc/workbench/contrib/debug/node/telemetryApp'),
	createModuleDescription('dc/platform/files/node/watcher/watcherMain'),
	createModuleDescription('dc/platform/localTranscription/node/localTranscriptionMain'),
	createModuleDescription('dc/platform/terminal/node/ptyHostMain'),
	createModuleDescription('dc/platform/agentHost/node/agentHostMain'),
	createModuleDescription('dc/platform/agentHost/node/diffWorkerMain'),
	createModuleDescription('dc/workbench/api/node/extensionHostProcess'),
	createModuleDescription('dc/workbench/workbench.desktop.main'),
	createModuleDescription('dc/sessions/sessions.desktop.main')
];

export const workbenchWeb = createModuleDescription('dc/workbench/workbench.web.main.internal');

export const sessionsWeb = createModuleDescription('dc/sessions/sessions.web.main.internal');

export const keyboardMaps = [
	createModuleDescription('dc/workbench/services/keybinding/browser/keyboardLayouts/layout.contribution.linux'),
	createModuleDescription('dc/workbench/services/keybinding/browser/keyboardLayouts/layout.contribution.darwin'),
	createModuleDescription('dc/workbench/services/keybinding/browser/keyboardLayouts/layout.contribution.win')
];

export const code = [
	// 'dc/code/electron-main/main' is not included here because it comes in via ./src/main.js
	// 'dc/code/node/cli' is not included here because it comes in via ./src/cli.js
	createModuleDescription('dc/code/node/cliProcessMain'),
	createModuleDescription('dc/code/electron-utility/sharedProcess/sharedProcessMain'),
	createModuleDescription('dc/code/electron-browser/workbench/workbench'),
	createModuleDescription('dc/sessions/electron-browser/sessions'),
];

export const codeWeb = createModuleDescription('dc/code/browser/workbench/workbench');

export const codeServer = [
	// 'dc/server/node/server.main' is not included here because it gets inlined via ./src/server-main.js
	// 'dc/server/node/server.cli' is not included here because it gets inlined via ./src/server-cli.js
	createModuleDescription('dc/workbench/api/node/extensionHostProcess'),
	createModuleDescription('dc/platform/files/node/watcher/watcherMain'),
	createModuleDescription('dc/platform/terminal/node/ptyHostMain'),
	createModuleDescription('dc/platform/agentHost/node/agentHostMain'),
	createModuleDescription('dc/platform/agentHost/node/diffWorkerMain'),
];

export const entrypoint = createModuleDescription;

const buildfile = {
	workerEditor,
	workerExtensionHost,
	workerNotebook,
	workerLanguageDetection,
	workerLocalFileSearch,
	workerProfileAnalysis,
	workerOutputLinks,
	workerBackgroundTokenization,
	workbenchDesktop,
	workbenchWeb,
	sessionsWeb,
	keyboardMaps,
	code,
	codeWeb,
	codeServer,
	entrypoint: createModuleDescription
};

export default buildfile;
