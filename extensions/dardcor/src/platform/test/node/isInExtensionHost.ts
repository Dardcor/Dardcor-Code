/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export const isInExtensionHost = !!process.env.VSCODE_SIMULATION_EXTENSION_ENTRY;

export const extensionHostWorkspaceUri = () => require('vscode').workspace.workspaceFolders![0].uri;
