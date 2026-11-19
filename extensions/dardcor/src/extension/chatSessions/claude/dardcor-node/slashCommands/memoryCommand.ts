/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { INativeEnvService } from '../../../../../platform/env/common/envService';
import { createDirectoryIfNotExists, IFileSystemService } from '../../../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../../../platform/log/common/logService';
import { IWorkspaceService } from '../../../../../platform/workspace/common/workspaceService';
import { CancellationToken } from '../../../../../util/dardcor/base/common/cancellation';
import { URI } from '../../../../../util/dardcor/base/common/uri';
import { IClaudeSlashCommandHandler, registerClaudeSlashCommand } from './claudeSlashCommandRegistry';


type MemoryLocationType = 'user' | 'project' | 'local';

interface MemoryLocation {
	type: MemoryLocationType;
	label: string;
	description: string;
	path: URI;
	workspaceFolder?: URI;
}

export class MemorySlashCommand implements IClaudeSlashCommandHandler {
	readonly commandName = 'memory';
	readonly description = 'Open memory files (CLAUDE.md) for editing';
	readonly commandId = 'dardcor.claude.memory';

	constructor(
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@INativeEnvService private readonly envService: INativeEnvService,
		@ILogService private readonly logService: ILogService,
	) { }

	async handle(
		_args: string,
		stream: vscode.ChatResponseStream | undefined,
		_token: CancellationToken
	): Promise<vscode.ChatResult> {
		stream?.markdown(vscode.l10n.t('Opening memory file picker...'));

		this._runPicker().catch(error => {
			this.logService.error('[MemorySlashCommand] Error running memory picker:', error);
			vscode.window.showErrorMessage(
				vscode.l10n.t('Error opening memory file: {0}', error instanceof Error ? error.message : String(error))
			);
		});

		return {};
	}

	private async _runPicker(): Promise<void> {
		const locations = this._getMemoryLocations();

		const items = await this._buildQuickPickItems(locations);

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: vscode.l10n.t('Select memory file to edit'),
			ignoreFocusOut: true,
		});

		if (selected) {
			await this._openOrCreateMemoryFile(selected.location);
		}
	}

	private _getMemoryLocations(): MemoryLocation[] {
		const locations: MemoryLocation[] = [];
		const homeDir = this.envService.userHome.fsPath;

		const userPath = URI.joinPath(this.envService.userHome, '.claude', 'CLAUDE.md');
		let userDisplayPath = userPath.fsPath;
		if (homeDir && userDisplayPath.startsWith(homeDir)) {
			userDisplayPath = '~' + userDisplayPath.slice(homeDir.length);
		}
		locations.push({
			type: 'user',
			label: vscode.l10n.t('User memory'),
			description: userDisplayPath,
			path: userPath,
		});

		const workspaceFolders = this.workspaceService.getWorkspaceFolders();
		for (const folder of workspaceFolders) {
			const folderName = this.workspaceService.getWorkspaceFolderName(folder);
			const isMultiRoot = workspaceFolders.length > 1;

			locations.push({
				type: 'project',
				label: isMultiRoot
					? vscode.l10n.t('Project memory - {0}', folderName)
					: vscode.l10n.t('Project memory'),
				description: '.claude/CLAUDE.md',
				path: URI.joinPath(folder, '.claude', 'CLAUDE.md'),
				workspaceFolder: folder,
			});

			locations.push({
				type: 'local',
				label: isMultiRoot
					? vscode.l10n.t('Project memory (local) - {0}', folderName)
					: vscode.l10n.t('Project memory (local)'),
				description: '.claude/CLAUDE.local.md',
				path: URI.joinPath(folder, '.claude', 'CLAUDE.local.md'),
				workspaceFolder: folder,
			});
		}

		return locations;
	}

	private async _buildQuickPickItems(locations: MemoryLocation[]): Promise<(vscode.QuickPickItem & { location: MemoryLocation })[]> {
		const items: (vscode.QuickPickItem & { location: MemoryLocation })[] = [];

		for (const location of locations) {
			const exists = await this._fileExists(location.path);

			items.push({
				label: exists ? `$(file) ${location.label}` : `$(file-add) ${location.label}`,
				description: exists ? location.description : vscode.l10n.t('{0} (will be created)', location.description),
				location,
			});
		}

		return items;
	}

	private async _fileExists(path: URI): Promise<boolean> {
		try {
			await this.fileSystemService.stat(path);
			return true;
		} catch {
			return false;
		}
	}

	private async _openOrCreateMemoryFile(location: MemoryLocation): Promise<void> {
		const exists = await this._fileExists(location.path);

		if (!exists) {
			const dir = URI.joinPath(location.path, '..');
			await createDirectoryIfNotExists(this.fileSystemService, dir);

			const template = this._getTemplate(location.type);
			await this.fileSystemService.writeFile(location.path, new TextEncoder().encode(template));
		}

		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(location.path.fsPath));
		await vscode.window.showTextDocument(doc);
	}

	private _getTemplate(type: MemoryLocationType): string {
		switch (type) {
			case 'user':
				return `# User Memory

Instructions here apply to all projects.

## Preferences

`;
			case 'project':
				return `# Project Memory

Instructions here apply to this project and are shared with team members.

## Context

`;
			case 'local':
				return `# Project Memory (Local)

Instructions here apply to this project but should not be checked into version control.

## Local Notes

`;
		}
	}
}

registerClaudeSlashCommand(MemorySlashCommand);
