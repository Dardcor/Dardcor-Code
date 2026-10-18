/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownString, type IMarkdownString } from '../../../../../../../../base/common/htmlContent.js';
import { visit, type JSONVisitor } from '../../../../../../../../base/common/json.js';
import { Disposable } from '../../../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../../../base/common/uri.js';
import { IUriIdentityService } from '../../../../../../../../platform/uriIdentity/common/uriIdentity.js';
import { localize } from '../../../../../../../../nls.js';
import { IConfigurationService } from '../../../../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService, type IWorkspaceFolder } from '../../../../../../../../platform/workspace/common/workspace.js';
import { TerminalChatAgentToolsSettingId } from '../../../../common/terminalChatAgentToolsConfiguration.js';

const npmRunPatterns = [
	/^(?<command>npm)\s+(?:run(?:-script)?)\s+(?<scriptName>[^\s&|;]+)/i,
	/^(?<command>npm)\s+(?<scriptName>test|start|stop|restart)\b/i,
	/^(?<command>yarn)\s+(?:run\s+)?(?<scriptName>[^\s&|;]+)/i,
	/^(?<command>pnpm)\s+(?:run\s+)?(?<scriptName>[^\s&|;]+)/i,
];

const yarnBuiltinCommands = new Set([
	'add', 'audit', 'autoclean', 'bin', 'cache', 'check', 'config',
	'create', 'dedupe', 'dlx', 'exec', 'explain', 'generate-lock-entry',
	'global', 'help', 'import', 'info', 'init', 'install', 'licenses',
	'link', 'list', 'login', 'logout', 'node', 'outdated', 'owner',
	'pack', 'patch', 'patch-commit', 'plugin', 'policies', 'publish',
	'rebuild', 'remove', 'run', 'search', 'set', 'stage', 'tag', 'team',
	'unlink', 'unplug', 'up', 'upgrade', 'upgrade-interactive',
	'version', 'versions', 'why', 'workspace', 'workspaces',
]);

const pnpmBuiltinCommands = new Set([
	'add', 'audit', 'bin', 'config', 'dedupe', 'deploy', 'dlx', 'doctor',
	'env', 'exec', 'fetch', 'import', 'init', 'install', 'install-test',
	'licenses', 'link', 'list', 'ln', 'ls', 'outdated', 'pack', 'patch',
	'patch-commit', 'patch-remove', 'prune', 'publish', 'rb', 'rebuild',
	'remove', 'rm', 'root', 'run', 'server', 'setup', 'store',
	'un', 'uninstall', 'unlink', 'up', 'update', 'why',
]);

interface IPackageJsonScripts {
	uri: URI;
	scripts: Set<string>;
}

export interface INpmScriptAutoApproveResult {
	isAutoApproved: boolean;
	scriptName?: string;
	autoApproveInfo?: IMarkdownString;
}

export class NpmScriptAutoApprover extends Disposable {

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IFileService private readonly _fileService: IFileService,
		@IUriIdentityService private readonly _uriIdentityService: IUriIdentityService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) {
		super();
	}

	async isCommandAutoApproved(command: string, cwd: URI | undefined): Promise<INpmScriptAutoApproveResult> {
		const isNpmScriptAutoApproveEnabled = this._configurationService.getValue(TerminalChatAgentToolsSettingId.AutoApproveWorkspaceNpmScripts) === true;
		if (!isNpmScriptAutoApproveEnabled) {
			return { isAutoApproved: false };
		}

		const scriptName = this._extractScriptName(command);
		if (!scriptName) {
			return { isAutoApproved: false };
		}

		const packageJsonScripts = await this._getPackageJsonScripts(cwd);
		if (!packageJsonScripts) {
			return { isAutoApproved: false };
		}

		if (!packageJsonScripts.scripts.has(scriptName)) {
			return { isAutoApproved: false };
		}

		return {
			isAutoApproved: true,
			scriptName,
			autoApproveInfo: new MarkdownString(
				localize('autoApprove.npmScript', 'Auto approved as {0} is defined in package.json', `\`${scriptName}\``)
			),
		};
	}

	private _extractScriptName(command: string): string | undefined {
		const trimmedCommand = command.trim();

		for (const pattern of npmRunPatterns) {
			const match = trimmedCommand.match(pattern);
			if (match?.groups?.scriptName) {
				const { command: pkgManager, scriptName } = match.groups;

				if (pkgManager.toLowerCase() === 'yarn' && yarnBuiltinCommands.has(scriptName.toLowerCase())) {
					continue;
				}
				if (pkgManager.toLowerCase() === 'pnpm' && pnpmBuiltinCommands.has(scriptName.toLowerCase())) {
					continue;
				}

				return scriptName;
			}
		}

		return undefined;
	}

	private _isWithinWorkspace(uri: URI): boolean {
		const workspaceFolders = this._workspaceContextService.getWorkspace().folders;
		return workspaceFolders.some((folder: IWorkspaceFolder) => this._uriIdentityService.extUri.isEqualOrParent(uri, folder.uri));
	}

	private async _getPackageJsonScripts(cwd: URI | undefined): Promise<IPackageJsonScripts | undefined> {
		if (!cwd || !this._isWithinWorkspace(cwd)) {
			return undefined;
		}

		const packageJsonUri = URI.joinPath(cwd, 'package.json');
		const scripts = await this._readPackageJsonScripts(packageJsonUri);
		if (scripts) {
			return { uri: packageJsonUri, scripts };
		}

		return undefined;
	}

	private async _readPackageJsonScripts(packageJsonUri: URI): Promise<Set<string> | undefined> {
		try {
			const exists = await this._fileService.exists(packageJsonUri);
			if (!exists) {
				return undefined;
			}

			const content = await this._fileService.readFile(packageJsonUri);
			const text = content.value.toString();

			return this._parsePackageJsonScripts(text);
		} catch {
			return undefined;
		}
	}

	private _parsePackageJsonScripts(content: string): Set<string> | undefined {
		const scripts = new Set<string>();
		let inScripts = false;
		let level = 0;

		const visitor: JSONVisitor = {
			onError() {
			},
			onObjectBegin() {
				level++;
			},
			onObjectEnd() {
				if (inScripts && level === 2) {
					inScripts = false;
				}
				level--;
			},
			onObjectProperty(property: string) {
				if (level === 1 && property === 'scripts') {
					inScripts = true;
				} else if (inScripts && level === 2) {
					scripts.add(property);
				}
			},
		};

		visit(content, visitor);

		return scripts.size > 0 ? scripts : undefined;
	}
}
