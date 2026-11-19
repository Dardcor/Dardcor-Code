/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

globalThis.COPILOT_SIMULATION_VSCODE = require('vscode');

exports.activate = require(process.env.VSCODE_SIMULATION_EXTENSION_ENTRY);
