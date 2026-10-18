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


const HOOK_EVENTS = [
	{
		id: 'PreToolUse',
		label: vscode.l10n.t('Before tool execution'),
		needsMatcher: true,
		inputDescription: vscode.l10n.t('Exit 0: allow, Exit 2: block with stderr to model.'),
		jsonSchema: '{ "tool_name": string, "tool_input": object }',
	},
	{
		id: 'PostToolUse',
		label: vscode.l10n.t('After tool execution'),
		needsMatcher: true,
		inputDescription: vscode.l10n.t('Runs after tool completes successfully.'),
		jsonSchema: '{ "tool_name": string, "tool_input": object, "tool_response": string }',
	},
	{
		id: 'PostToolUseFailure',
		label: vscode.l10n.t('After tool execution fails'),
		needsMatcher: true,
		inputDescription: vscode.l10n.t('Runs when a tool fails or is interrupted.'),
		jsonSchema: '{ "tool_name": string, "tool_input": object, "error": string, "is_interrupt": boolean }',
	},
	{
		id: 'PermissionRequest',
		label: vscode.l10n.t('When permission dialog would be displayed'),
		needsMatcher: true,
		inputDescription: vscode.l10n.t('Custom permission handling. Exit 0: allow, Exit 2: deny.'),
		jsonSchema: '{ "tool_name": string, "tool_input": object, "permission_suggestions": string[] }',
	},
	{
		id: 'UserPromptSubmit',
		label: vscode.l10n.t('When the user submits a prompt'),
		needsMatcher: false,
		inputDescription: vscode.l10n.t('Exit 0: allow, Exit 2: block with stderr to model.'),
		jsonSchema: '{ "prompt": string }',
	},
	{
		id: 'Stop',
		label: vscode.l10n.t('When agent execution stops'),
		needsMatcher: false,
		inputDescription: vscode.l10n.t('Use to save state or clean up resources.'),
		jsonSchema: '{ "stop_hook_active": boolean }',
	},
	{
		id: 'SubagentStart',
		label: vscode.l10n.t('When a subagent is initialized'),
		needsMatcher: false,
		inputDescription: vscode.l10n.t('Track parallel task spawning.'),
		jsonSchema: '{ "agent_id": string, "agent_type": string }',
	},
	{
		id: 'SubagentStop',
		label: vscode.l10n.t('When a subagent completes'),
		needsMatcher: false,
		inputDescription: vscode.l10n.t('Aggregate results from parallel tasks.'),
		jsonSchema: '{ "agent_id": string, "agent_transcript_path": string, "stop_hook_active": boolean }',
	},
	{
		id: 'PreCompact',
		label: vscode.l10n.t('Before conversation compaction'),
		needsMatcher: false,
		inputDescription: vscode.l10n.t('Archive transcript before summarizing.'),
		jsonSchema: '{ "trigger": "manual" | "auto", "custom_instructions": string }',
	},
	{
		id: 'SessionStart',
		label: vscode.l10n.t('When a session is initialized'),
		needsMatcher: false,
		inputDescription: vscode.l10n.t('Initialize logging and telemetry.'),
		jsonSchema: '{ "source": "startup" | "resume" | "clear" | "compact" }',
	},
	{
		id: 'SessionEnd',
		label: vscode.l10n.t('When a session terminates'),
		needsMatcher: false,
		inputDescription: vscode.l10n.t('Clean up temporary resources.'),
		jsonSchema: '{ "reason": "clear" | "logout" | "prompt_input_exit" | "other" }',
	},
	{
		id: 'Notification',
		label: vscode.l10n.t('When agent status messages are sent'),
		needsMatcher: false,
		inputDescription: vscode.l10n.t('Send updates to Slack or dashboards.'),
		jsonSchema: '{ "message": string, "notification_type": string, "title": string }',
	},
] as const;

type HookEventId = typeof HOOK_EVENTS[number]['id'];
type HookEvent = typeof HOOK_EVENTS[number];

type SettingsLocationType = 'local' | 'shared' | 'user';

interface SettingsLocation {
	type: SettingsLocationType;
	label: string;
	settingsPath: URI;
	workspaceFolder?: URI;
}

interface HookConfig {
	type: 'command';
	command: string;
}

interface MatcherConfig {
	matcher: string;
	hooks: HookConfig[];
}

interface HooksSettings {
	hooks?: Partial<Record<HookEventId, MatcherConfig[]>>;
}

interface MatcherWithSource {
	matcher: string;
	location: SettingsLocation;
}

interface HookWithSource {
	command: string;
	location: SettingsLocation;
}

interface IHooksWizardResult {
	event: string;
	matcher: string;
	command: string;
	location: string;
	mode: 'create' | 'edit';
}

export class HooksSlashCommand implements IClaudeSlashCommandHandler {
	readonly commandName = 'hooks';
	readonly description = 'Configure Claude Code hooks for tool execution and events';
	readonly commandId = 'dardcor.claude.hooks';

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
		stream?.markdown(vscode.l10n.t('Opening hooks configuration...'));

		this._runWizard().catch(error => {
			this.logService.error('[HooksSlashCommand] Error running hooks wizard:', error);
			vscode.window.showErrorMessage(
				vscode.l10n.t('Error configuring hook: {0}', error instanceof Error ? error.message : String(error))
			);
		});

		return {};
	}

	private async _runWizard(): Promise<IHooksWizardResult | undefined> {
		const eventConfig = await this._selectHookEvent();
		if (!eventConfig) {
			return undefined;
		}

		let matcher: string;
		let targetLocation: SettingsLocation;
		let mode: 'create' | 'edit';

		if (eventConfig.needsMatcher) {
			const matcherResult = await this._selectOrCreateMatcher(eventConfig);
			if (!matcherResult) {
				return undefined;
			}
			matcher = matcherResult.matcher;
			mode = matcherResult.mode;

			if (mode === 'edit') {
				targetLocation = matcherResult.location!;

				const hookResult = await this._selectOrAddHookForEdit(eventConfig, matcher, targetLocation);
				if (!hookResult) {
					return undefined;
				}

				await this._saveHookConfig(eventConfig.id, matcher, hookResult.command, targetLocation, hookResult.originalCommand);

				await this._openFileAtHook(targetLocation, hookResult.command);

				return this._showSuccessAndReturn(eventConfig, matcher, hookResult.command, targetLocation, mode);
			} else {
				const command = await this._enterCommand(eventConfig, matcher);
				if (!command) {
					return undefined;
				}

				const location = await this._selectSaveLocation();
				if (!location) {
					return undefined;
				}

				await this._saveHookConfig(eventConfig.id, matcher, command, location);

				await this._openFileAtHook(location, command);

				return this._showSuccessAndReturn(eventConfig, matcher, command, location, mode);
			}
		} else {
			matcher = '*';

			const existingHooks = await this._getExistingHooksWithSource(eventConfig.id, matcher);

			if (existingHooks.length > 0) {
				const hookResult = await this._selectOrAddHookFromList(eventConfig, matcher, existingHooks);
				if (!hookResult) {
					return undefined;
				}

				if (hookResult.mode === 'edit') {
					await this._saveHookConfig(eventConfig.id, matcher, hookResult.command, hookResult.location!, hookResult.originalCommand);
					await this._openFileAtHook(hookResult.location!, hookResult.command);
					return this._showSuccessAndReturn(eventConfig, matcher, hookResult.command, hookResult.location!, 'edit');
				} else {
					const location = await this._selectSaveLocation();
					if (!location) {
						return undefined;
					}
					await this._saveHookConfig(eventConfig.id, matcher, hookResult.command, location);
					await this._openFileAtHook(location, hookResult.command);
					return this._showSuccessAndReturn(eventConfig, matcher, hookResult.command, location, 'create');
				}
			} else {
				const command = await this._enterCommand(eventConfig, matcher);
				if (!command) {
					return undefined;
				}

				const location = await this._selectSaveLocation();
				if (!location) {
					return undefined;
				}

				await this._saveHookConfig(eventConfig.id, matcher, command, location);
				await this._openFileAtHook(location, command);
				return this._showSuccessAndReturn(eventConfig, matcher, command, location, 'create');
			}
		}
	}

	private async _openFileAtHook(location: SettingsLocation, command: string): Promise<void> {
		try {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(location.settingsPath.fsPath));
			const text = document.getText();

			const commandEscaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const regex = new RegExp(`"command"\\s*:\\s*"${commandEscaped}"`);
			const match = regex.exec(text);

			let position = new vscode.Position(0, 0);
			if (match) {
				const beforeMatch = text.substring(0, match.index);
				const lineNumber = (beforeMatch.match(/\n/g) || []).length;
				const lastNewline = beforeMatch.lastIndexOf('\n');
				const column = match.index - lastNewline - 1 + match[0].indexOf(command);
				position = new vscode.Position(lineNumber, column);
			}

			const editor = await vscode.window.showTextDocument(document, {
				selection: new vscode.Range(position, position),
				preview: false,
			});

			editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
		} catch (error) {
			this.logService.warn(`[HooksSlashCommand] Failed to open file at hook position: ${error}`);
		}
	}

	private _showSuccessAndReturn(
		eventConfig: HookEvent,
		matcher: string,
		command: string,
		location: SettingsLocation,
		mode: 'create' | 'edit'
	): IHooksWizardResult {
		return {
			event: eventConfig.label,
			matcher,
			command,
			location: location.label,
			mode,
		};
	}

	private async _selectHookEvent(): Promise<HookEvent | undefined> {
		const items = HOOK_EVENTS.map((event, index) => ({
			label: `${index + 1}. ${event.id}`,
			description: event.label,
			event,
		}));

		const selected = await vscode.window.showQuickPick(items, {
			title: vscode.l10n.t('Configure Hook'),
			placeHolder: vscode.l10n.t('Which hook would you like to configure?'),
			matchOnDetail: true,
			ignoreFocusOut: true
		});

		return selected?.event;
	}

	private async _selectOrCreateMatcher(eventConfig: HookEvent): Promise<{
		matcher: string;
		mode: 'create' | 'edit';
		location?: SettingsLocation;
	} | undefined> {
		const existingMatchers = await this._getExistingMatchersWithSource(eventConfig.id);

		type MatcherItem = vscode.QuickPickItem & {
			isAddNew: boolean;
			matcher?: string;
			location?: SettingsLocation;
		};

		const addNewItem: MatcherItem = {
			label: '$(add) ' + vscode.l10n.t('Add new matcher...'),
			isAddNew: true,
		};

		const items: (MatcherItem | vscode.QuickPickItem)[] = [addNewItem];

		const matchersByLocation = new Map<string, MatcherWithSource[]>();
		for (const m of existingMatchers) {
			const existing = matchersByLocation.get(m.location.label) || [];
			existing.push(m);
			matchersByLocation.set(m.location.label, existing);
		}

		for (const [locationLabel, matchers] of matchersByLocation) {
			items.push({
				label: locationLabel,
				kind: vscode.QuickPickItemKind.Separator,
			});

			for (const m of matchers) {
				items.push({
					label: m.matcher,
					isAddNew: false,
					matcher: m.matcher,
					location: m.location,
				});
			}
		}

		const selected = await vscode.window.showQuickPick(items, {
			title: vscode.l10n.t('Configure Hook: {0}', eventConfig.id),
			placeHolder: vscode.l10n.t('Which tool should trigger this hook?'),
			ignoreFocusOut: true,
		}) as MatcherItem | undefined;

		if (!selected) {
			return undefined;
		}

		if (selected.isAddNew) {
			const newMatcher = await vscode.window.showInputBox({
				title: vscode.l10n.t('Configure Hook: {0}', eventConfig.id),
				prompt: vscode.l10n.t('Enter a tool name or pattern (e.g., "Bash", "Edit", or "*" for all)'),
				placeHolder: vscode.l10n.t('Which tool should trigger this hook?'),
				ignoreFocusOut: true,
			});

			if (!newMatcher) {
				return undefined;
			}

			return { matcher: newMatcher, mode: 'create' };
		}

		return {
			matcher: selected.matcher!,
			mode: 'edit',
			location: selected.location,
		};
	}

	private async _selectOrAddHookForEdit(
		eventConfig: HookEvent,
		matcher: string,
		location: SettingsLocation
	): Promise<{ command: string; originalCommand?: string } | undefined> {
		const existingHooks = await this._getHooksAtLocation(eventConfig.id, matcher, location);

		type HookItem = vscode.QuickPickItem & {
			isAddNew: boolean;
			command?: string;
		};

		const addNewItem: HookItem = {
			label: '$(add) ' + vscode.l10n.t('Add new hook...'),
			isAddNew: true,
		};

		const items: (HookItem | vscode.QuickPickItem)[] = [addNewItem];

		if (existingHooks.length > 0) {
			items.push({
				label: location.label,
				kind: vscode.QuickPickItemKind.Separator,
			});

			for (const h of existingHooks) {
				items.push({
					label: h,
					isAddNew: false,
					command: h,
				});
			}
		}

		const selected = await vscode.window.showQuickPick(items, {
			title: vscode.l10n.t('Configure Hook: {0} → {1}', eventConfig.id, matcher),
			placeHolder: vscode.l10n.t('Select a hook to edit or add a new one'),
			ignoreFocusOut: true,
		}) as HookItem | undefined;

		if (!selected) {
			return undefined;
		}

		if (selected.isAddNew) {
			const command = await this._enterCommand(eventConfig, matcher, location.label);
			if (!command) {
				return undefined;
			}
			return { command };
		}

		const editedCommand = await vscode.window.showInputBox({
			title: vscode.l10n.t('Edit Hook: {0} → {1}', eventConfig.id, matcher),
			value: selected.command,
			prompt: vscode.l10n.t('Modifying {0}. Stdin Input: {1}', location.label, eventConfig.jsonSchema),
			placeHolder: './my-hook-script.sh',
			ignoreFocusOut: true,
		});

		if (!editedCommand) {
			return undefined;
		}

		return { command: editedCommand, originalCommand: selected.command };
	}

	private async _selectOrAddHookFromList(
		eventConfig: HookEvent,
		matcher: string,
		existingHooks: HookWithSource[]
	): Promise<{
		command: string;
		mode: 'create' | 'edit';
		location?: SettingsLocation;
		originalCommand?: string;
	} | undefined> {
		type HookItem = vscode.QuickPickItem & {
			isAddNew: boolean;
			command?: string;
			location?: SettingsLocation;
		};

		const addNewItem: HookItem = {
			label: '$(add) ' + vscode.l10n.t('Add new hook...'),
			isAddNew: true,
		};

		const items: (HookItem | vscode.QuickPickItem)[] = [addNewItem];

		const hooksByLocation = new Map<string, HookWithSource[]>();
		for (const h of existingHooks) {
			const existing = hooksByLocation.get(h.location.label) || [];
			existing.push(h);
			hooksByLocation.set(h.location.label, existing);
		}

		for (const [locationLabel, hooks] of hooksByLocation) {
			items.push({
				label: locationLabel,
				kind: vscode.QuickPickItemKind.Separator,
			});

			for (const h of hooks) {
				items.push({
					label: h.command,
					isAddNew: false,
					command: h.command,
					location: h.location,
				});
			}
		}

		const selected = await vscode.window.showQuickPick(items, {
			title: vscode.l10n.t('Configure Hook: {0}', eventConfig.id),
			placeHolder: vscode.l10n.t('Select a hook to edit or add a new one'),
			ignoreFocusOut: true,
		}) as HookItem | undefined;

		if (!selected) {
			return undefined;
		}

		if (selected.isAddNew) {
			const command = await this._enterCommand(eventConfig, matcher);
			if (!command) {
				return undefined;
			}
			return { command, mode: 'create' };
		}

		const editedCommand = await vscode.window.showInputBox({
			title: vscode.l10n.t('Edit Hook: {0}', eventConfig.id),
			value: selected.command,
			prompt: vscode.l10n.t('Modifying {0}. Stdin Input: {1}', selected.location!.label, eventConfig.jsonSchema),
			placeHolder: './my-hook-script.sh',
			ignoreFocusOut: true,
		});

		if (!editedCommand) {
			return undefined;
		}

		return {
			command: editedCommand,
			mode: 'edit',
			location: selected.location,
			originalCommand: selected.command,
		};
	}

	private async _enterCommand(eventConfig: HookEvent, matcher: string, locationLabel?: string): Promise<string | undefined> {
		const promptText = locationLabel
			? vscode.l10n.t('Modifying {0}. Stdin Input: {1}', locationLabel, eventConfig.jsonSchema)
			: vscode.l10n.t('What shell command should run? Stdin Input: {0}', eventConfig.jsonSchema);

		return vscode.window.showInputBox({
			title: eventConfig.needsMatcher
				? vscode.l10n.t('Configure Hook: {0} → {1}', eventConfig.id, matcher)
				: vscode.l10n.t('Configure Hook: {0}', eventConfig.id),
			placeHolder: './my-hook-script.sh',
			prompt: promptText,
			ignoreFocusOut: true,
		});
	}

	private async _selectSaveLocation(): Promise<SettingsLocation | undefined> {
		type LocationItem = vscode.QuickPickItem & {
			location: SettingsLocation;
		};

		const items: LocationItem[] = [];
		const homeDir = this.envService.userHome.fsPath;
		const workspaceFolders = this.workspaceService.getWorkspaceFolders();

		for (const folderUri of workspaceFolders) {
			const folderName = this.workspaceService.getWorkspaceFolderName(folderUri);

			const localPath = URI.joinPath(folderUri, '.claude', 'settings.local.json');
			items.push({
				label: workspaceFolders.length > 1
					? vscode.l10n.t('Workspace (local) - {0}', folderName)
					: vscode.l10n.t('Workspace (local)'),
				description: `${folderName}/.claude/settings.local.json`,
				location: {
					type: 'local',
					label: workspaceFolders.length > 1 ? vscode.l10n.t('Workspace (local) - {0}', folderName) : vscode.l10n.t('Workspace (local)'),
					workspaceFolder: folderUri,
					settingsPath: localPath,
				},
			});

			const sharedPath = URI.joinPath(folderUri, '.claude', 'settings.json');
			items.push({
				label: workspaceFolders.length > 1
					? vscode.l10n.t('Workspace - {0}', folderName)
					: vscode.l10n.t('Workspace'),
				description: `${folderName}/.claude/settings.json`,
				location: {
					type: 'shared',
					label: workspaceFolders.length > 1 ? vscode.l10n.t('Workspace - {0}', folderName) : vscode.l10n.t('Workspace'),
					workspaceFolder: folderUri,
					settingsPath: sharedPath,
				},
			});
		}

		const userPath = URI.joinPath(this.envService.userHome, '.claude', 'settings.json');
		let userDisplayPath = userPath.fsPath;
		if (homeDir && userDisplayPath.startsWith(homeDir)) {
			userDisplayPath = '~' + userDisplayPath.slice(homeDir.length);
		}
		items.push({
			label: vscode.l10n.t('User'),
			description: userDisplayPath,
			location: {
				type: 'user',
				label: vscode.l10n.t('User'),
				settingsPath: userPath,
			},
		});

		const selected = await vscode.window.showQuickPick(items, {
			title: vscode.l10n.t('Save Hook Configuration'),
			placeHolder: vscode.l10n.t('Where should this hook be saved?'),
			ignoreFocusOut: true,
		});

		return selected?.location;
	}

	private _getAllSettingsLocations(): SettingsLocation[] {
		const locations: SettingsLocation[] = [];
		const workspaceFolders = this.workspaceService.getWorkspaceFolders();

		for (const folderUri of workspaceFolders) {
			const folderName = this.workspaceService.getWorkspaceFolderName(folderUri);

			locations.push({
				type: 'local',
				label: workspaceFolders.length > 1 ? vscode.l10n.t('Workspace (local) - {0}', folderName) : vscode.l10n.t('Workspace (local)'),
				workspaceFolder: folderUri,
				settingsPath: URI.joinPath(folderUri, '.claude', 'settings.local.json'),
			});

			locations.push({
				type: 'shared',
				label: workspaceFolders.length > 1 ? vscode.l10n.t('Workspace - {0}', folderName) : vscode.l10n.t('Workspace'),
				workspaceFolder: folderUri,
				settingsPath: URI.joinPath(folderUri, '.claude', 'settings.json'),
			});
		}

		locations.push({
			type: 'user',
			label: vscode.l10n.t('User'),
			settingsPath: URI.joinPath(this.envService.userHome, '.claude', 'settings.json'),
		});

		return locations;
	}

	private async _loadSettings(settingsPath: URI): Promise<HooksSettings> {
		try {
			const content = await this.fileSystemService.readFile(settingsPath);
			return JSON.parse(new TextDecoder().decode(content)) as HooksSettings;
		} catch {
			return {};
		}
	}

	private async _saveSettings(settingsPath: URI, settings: HooksSettings): Promise<void> {
		const dirPath = URI.joinPath(settingsPath, '..');
		await createDirectoryIfNotExists(this.fileSystemService, dirPath);

		const content = JSON.stringify(settings, null, '  ');
		await this.fileSystemService.writeFile(settingsPath, new TextEncoder().encode(content));
	}

	private async _saveHookConfig(
		event: HookEventId,
		matcher: string,
		command: string,
		location: SettingsLocation,
		originalCommand?: string
	): Promise<void> {
		const settingsPath = location.settingsPath;
		const settings = await this._loadSettings(settingsPath);

		if (!settings.hooks) {
			settings.hooks = {};
		}

		if (!settings.hooks[event]) {
			settings.hooks[event] = [];
		}

		let matcherConfig = settings.hooks[event]!.find(m => m.matcher === matcher);
		if (!matcherConfig) {
			matcherConfig = { matcher, hooks: [] };
			settings.hooks[event]!.push(matcherConfig);
		}

		if (originalCommand) {
			const hookIndex = matcherConfig.hooks.findIndex(h => h.command === originalCommand);
			if (hookIndex >= 0) {
				matcherConfig.hooks[hookIndex] = { type: 'command', command };
			} else {
				matcherConfig.hooks.push({ type: 'command', command });
			}
		} else {
			const existingHook = matcherConfig.hooks.find(h => h.command === command);
			if (!existingHook) {
				matcherConfig.hooks.push({ type: 'command', command });
			}
		}

		await this._saveSettings(settingsPath, settings);
	}

	private async _getExistingMatchersWithSource(event: HookEventId): Promise<MatcherWithSource[]> {
		const matchers: MatcherWithSource[] = [];
		const allLocations = this._getAllSettingsLocations();

		for (const location of allLocations) {
			try {
				const settings = await this._loadSettings(location.settingsPath);
				if (settings.hooks?.[event]) {
					for (const matcherConfig of settings.hooks[event]!) {
						const existing = matchers.find(m => m.matcher === matcherConfig.matcher);
						if (!existing) {
							matchers.push({
								matcher: matcherConfig.matcher,
								location,
							});
						}
					}
				}
			} catch {
			}
		}

		return matchers;
	}

	private async _getExistingHooksWithSource(event: HookEventId, matcher: string): Promise<HookWithSource[]> {
		const hooks: HookWithSource[] = [];
		const allLocations = this._getAllSettingsLocations();

		for (const location of allLocations) {
			try {
				const settings = await this._loadSettings(location.settingsPath);
				if (settings.hooks?.[event]) {
					const matcherConfig = settings.hooks[event]!.find(m => m.matcher === matcher);
					if (matcherConfig) {
						for (const hook of matcherConfig.hooks) {
							hooks.push({
								command: hook.command,
								location,
							});
						}
					}
				}
			} catch {
			}
		}

		return hooks;
	}

	private async _getHooksAtLocation(event: HookEventId, matcher: string, location: SettingsLocation): Promise<string[]> {
		try {
			const settings = await this._loadSettings(location.settingsPath);
			if (settings.hooks?.[event]) {
				const matcherConfig = settings.hooks[event]!.find(m => m.matcher === matcher);
				if (matcherConfig) {
					return matcherConfig.hooks.map(h => h.command);
				}
			}
		} catch {
		}
		return [];
	}
}

registerClaudeSlashCommand(HooksSlashCommand);
