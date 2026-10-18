/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { BaseServiceConfigurationProvider } from './configuration';

export class BrowserServiceConfigurationProvider extends BaseServiceConfigurationProvider {

	protected readGlobalTsdk(_configuration: vscode.WorkspaceConfiguration): string | null {
		return null;
	}

	protected readLocalTsdk(_configuration: vscode.WorkspaceConfiguration): string | null {
		return null;
	}

	protected readLocalNodePath(_configuration: vscode.WorkspaceConfiguration): string | null {
		return null;
	}

	protected override readGlobalNodePath(_configuration: vscode.WorkspaceConfiguration): string | null {
		return null;
	}
}
