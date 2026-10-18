/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { t } from '@vscode/l10n';
import * as vscode from 'vscode';
import { ResolvedRepoRemoteInfo } from '../../../platform/git/common/gitService';
import { ILogService } from '../../../platform/log/common/logService';
import { ICodeSearchAuthenticationService } from '../../../platform/remoteCodeSearch/node/codeSearchRepoAuth';
import { ExternalIngestEnablement } from '../../../platform/workspaceChunkSearch/node/codeSearch/codeSearchChunkSearch';
import { CodeSearchRepoStatus } from '../../../platform/workspaceChunkSearch/node/codeSearch/codeSearchRepo';
import { IWorkspaceChunkSearchService, WorkspaceIndexState } from '../../../platform/workspaceChunkSearch/node/workspaceChunkSearchService';
import { coalesce } from '../../../util/dardcor/base/common/arrays';
import { Emitter, Event } from '../../../util/dardcor/base/common/event';
import { Disposable, DisposableStore, IDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { commandUri } from '../../linkify/common/commands';
import { buildRemoteIndexCommandId, enableExternalIngestCommandId } from './commands';


const reauthenticateCommandId = '_dardcor.workspaceIndex.signInAgain';

const codebaseSemanticSearchDocsLink = 'https://www.dardcor-code.web.id/docs/workspaces/remote-index';
const externalIngestPolicyLink = 'https://www.dardcor-code.web.id/docs/enterprise/data-and-privacy';
const enableExternalIngestCommandLink = `command:${enableExternalIngestCommandId}`;

const enableExternalIngestCommandTitle = t('Enable External Ingest');
const externalIngestPolicyDetail = t('External ingest is disabled by your organization\'s policy. [Learn more]({0})', externalIngestPolicyLink);
const externalIngestPolicyNoReposDetail = t('External ingest is disabled by your organization\'s policy, and no external repositories were found. [Learn more]({0})', externalIngestPolicyLink);
const externalIngestPolicyAvailableDetail = t('External ingest is disabled by your organization\'s policy. Results may be incomplete or out of date. [Learn more]({0})', externalIngestPolicyLink);
const externalIngestDisabledInWorkspaceDetail = t`External ingest is disabled in this workspace.`;
const externalIngestDisabledInWorkspaceNoReposDetail = t`External ingest is disabled in this workspace, and no external repositories were found.`;
const enableExternalIngestDetail = t('External ingest is disabled in this workspace. [Enable external ingest?]({0} "{1}")', enableExternalIngestCommandLink, enableExternalIngestCommandTitle);
const enableExternalIngestNoReposDetail = t('External ingest is disabled in this workspace, and no external repositories were found. [Enable external ingest?]({0} "{1}")', enableExternalIngestCommandLink, enableExternalIngestCommandTitle);

interface WorkspaceIndexStateReporter {
	readonly onDidChangeIndexState: Event<void>;

	getIndexState(): Promise<WorkspaceIndexState>;
}

export class MockWorkspaceIndexStateReporter extends Disposable implements WorkspaceIndexStateReporter {
	private _indexState: WorkspaceIndexState;

	private readonly _onDidChangeIndexState = this._register(new Emitter<void>());
	public readonly onDidChangeIndexState = this._onDidChangeIndexState.event;

	constructor(initialState: WorkspaceIndexState) {
		super();

		this._indexState = initialState;
	}

	async getIndexState(): Promise<WorkspaceIndexState> {
		return this._indexState;
	}

	updateIndexState(newState: WorkspaceIndexState): void {
		this._indexState = newState;
		this._onDidChangeIndexState.fire();
	}
}

interface ChatStatusItemState {
	readonly primary: {
		readonly message: string;
		readonly icon?: string;
		readonly busy?: boolean;
	};
	readonly details?: {
		readonly message: string;
		readonly busy: boolean;
	};
	readonly tooltip?: string;
}

const spinnerCodicon = '$(loading~spin)';
const warningCodicon = '$(warning)';
const errorCodicon = '$(error)';
const checkCodicon = '$(check)';
const statusTitle = t`Codebase Semantic Index`;

export class ChatStatusWorkspaceIndexingStatus extends Disposable {

	private readonly _statusItem: vscode.ChatStatusItem;

	private readonly _statusReporter: WorkspaceIndexStateReporter;

	constructor(
		@IWorkspaceChunkSearchService workspaceChunkSearch: IWorkspaceChunkSearchService,
		@ICodeSearchAuthenticationService private readonly _codeSearchAuthService: ICodeSearchAuthenticationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._statusReporter = workspaceChunkSearch;

		this._statusItem = this._register(vscode.window.createChatStatusItem('dardcor.workspaceIndexStatus'));
		this._statusItem.title = statusTitle;

		this._register(this._statusReporter.onDidChangeIndexState(() => this._updateStatusItem()));

		this._register(this.registerCommands());

		this._writeStatusItem({
			primary: {
				message: t`Checking...`,
				icon: spinnerCodicon,
			},
			details: undefined,
			tooltip: t`Checking the current index status...`,
		});

		this._updateStatusItem();
	}

	private currentUpdateRequestId = 0;

	private async _updateStatusItem(): Promise<void> {
		const id = ++this.currentUpdateRequestId;
		this._logService.trace(`ChatStatusWorkspaceIndexingStatus::updateStatusItem(id=${id}): starting`);

		const state = await this._statusReporter.getIndexState();

		if (id !== this.currentUpdateRequestId) {
			this._logService.trace(`ChatStatusWorkspaceIndexingStatus::updateStatusItem(id=${id}): skipping`);
			return;
		}

		switch (state.remoteIndexState.status) {
			case 'initializing':
				return this._writeStatusItem({
					primary: {
						message: t`Checking...`,
						icon: spinnerCodicon,
					},
					tooltip: t`Checking the current index status...`,
				});

			case 'loaded': {
				const externalIngestDisabledByPolicy = state.remoteIndexState.externalIngestEnablement === ExternalIngestEnablement.DisabledByPolicy;
				const externalIngestDisabledInWorkspace = state.remoteIndexState.externalIngestEnablement === ExternalIngestEnablement.DisabledBySetting;
				const noRepos = state.remoteIndexState.repos.length === 0;

				if (state.remoteIndexState.repos.some(repo => repo.status === CodeSearchRepoStatus.Resolving)) {
					return this._writeStatusItem({
						primary: {
							message: t`Resolving...`,
							icon: spinnerCodicon,
						},
						tooltip: t`Resolving repository information...`,
					});
				}

				if (state.remoteIndexState.repos.some(repo => repo.status === CodeSearchRepoStatus.CheckingStatus)) {
					return this._writeStatusItem({
						primary: {
							message: t`Checking...`,
							icon: spinnerCodicon,
						},
						tooltip: t`Checking the current index status...`,
					});
				}

				if (state.remoteIndexState.repos.some(repo => repo.status === CodeSearchRepoStatus.BuildingIndex)
					|| state.remoteIndexState.externalIngestState?.status === CodeSearchRepoStatus.BuildingIndex
				) {
					return this._writeStatusItem({
						primary: {
							message: t`Indexing...`,
							icon: spinnerCodicon,
						},
						tooltip: t`Your codebase is currently being indexed. This may take a few minutes.`,
					});
				}

				if (externalIngestDisabledInWorkspace && !state.remoteIndexState.hasPromptedForExternalIngest) {
					return this._writeStatusItem({
						primary: {
							message: t`Disabled`,
							icon: noRepos ? errorCodicon : warningCodicon,
						},
						details: {
							message: noRepos ? enableExternalIngestNoReposDetail : enableExternalIngestDetail,
							busy: false,
						},
						tooltip: t`External ingest is disabled in this workspace.`,
					});
				}

				const readyRepos = state.remoteIndexState.repos.filter(repo => repo.status === CodeSearchRepoStatus.Ready);
				const notAuthorizedRepos = state.remoteIndexState.repos.filter(repo => repo.status === CodeSearchRepoStatus.NotAuthorized);
				if (notAuthorizedRepos.length > 0) {
					const inaccessibleRepo = notAuthorizedRepos[0].remoteInfo;
					if (readyRepos.length > 0) {
						return this._writeStatusItem({
							primary: {
								message: readyRepos.length === 1
									? t`1 repo with index`
									: t`${readyRepos.length} repos with indexes`,
								icon: '$(warning)',
							},
							details: {
								message: `[${t`Sign in?`}](${commandUri(reauthenticateCommandId, [inaccessibleRepo])} "${t('Try signing in again to use the codebase index')}")`,
								busy: false,
							},
							tooltip: notAuthorizedRepos.length === 1
								? t`1 additional repo needs re-authentication.`
								: t`${notAuthorizedRepos.length} additional repos need re-authentication.`,
						});
					} else {
						return this._writeStatusItem({
							primary: {
								message: t`Not authorized`,
								icon: '$(lock)',
							},
							details: {
								message: `[${t`Sign in?`}](${commandUri(reauthenticateCommandId, [inaccessibleRepo])} "${t('Try signing in again to use the codebase index')}")`,
								busy: false,
							},
							tooltip: t`You don't have permission to access the index for this repository.`,
						});
					}
				}

				if (externalIngestDisabledByPolicy && readyRepos.length > 0) {
					return this._writeStatusItem({
						primary: {
							message: t`Available`,
							icon: warningCodicon,
						},
						details: {
							message: externalIngestPolicyAvailableDetail,
							busy: false,
						},
						tooltip: t`Codebase semantic search is available from indexed repositories, but external ingest is disabled by your organization's policy. Results may be incomplete or out of date.`,
					});
				}

				const errorRepos = state.remoteIndexState.repos.filter(repo => repo.status === CodeSearchRepoStatus.CouldNotCheckIndexStatus);
				if (errorRepos.length > 0) {
					return this._writeStatusItem({
						primary: {
							message: t`Not available`,
							icon: errorCodicon,
						},
						tooltip: t`This repository can't be indexed. It may be too large or not supported.`,
					});
				}

				if (state.remoteIndexState.repos.some(repo => repo.status === CodeSearchRepoStatus.NotYetIndexed)) {
					return this._writeStatusItem({
						primary: {
							message: t`Not indexed`,
						},
						details: {
							message: `[${t`Index?`}](command:${buildRemoteIndexCommandId} "${t('Build Codebase Index')}")`,
							busy: false,
						},
						tooltip: t`This repository hasn't been indexed yet. Trigger indexing to enable semantic search.`,
					});
				}

				if (
					state.remoteIndexState.externalIngestState?.status === CodeSearchRepoStatus.Ready
					|| (
						!state.remoteIndexState.externalIngestState
						&& state.remoteIndexState.repos.length > 0
						&& state.remoteIndexState.repos.every(repo => repo.status === CodeSearchRepoStatus.Ready)
					)
				) {
					return this._writeStatusItem({
						primary: {
							message: t`Ready`,
							icon: externalIngestDisabledInWorkspace ? warningCodicon : checkCodicon,
						},
						details: externalIngestDisabledInWorkspace ? {
							message: externalIngestDisabledInWorkspaceDetail,
							busy: false,
						} : undefined,
						tooltip: t`Your index is up to date and being used to improve suggestions.`,
					});
				}

				if (externalIngestDisabledInWorkspace) {
					return this._writeStatusItem({
						primary: {
							message: t`Disabled`,
							icon: noRepos ? errorCodicon : warningCodicon,
						},
						details: {
							message: noRepos ? externalIngestDisabledInWorkspaceNoReposDetail : externalIngestDisabledInWorkspaceDetail,
							busy: false,
						},
						tooltip: t`External ingest is disabled in this workspace.`,
					});
				}

				if (typeof state.remoteIndexState.externalIngestState !== 'undefined') {
					return this._writeStatusItem({
						primary: {
							message: t`Out of date`,
						},
						details: {
							message: `[${t`Update?`}](command:${buildRemoteIndexCommandId} "${t('Update Codebase Index')}")`,
							busy: false,
						},
						tooltip: t`Your index is out of date. Recent changes haven't been indexed yet.`,
					});
				}

				break;
			}
			case 'disabled': {
				break;
			}
		}

		const externalIngestDisabledByPolicy = state.remoteIndexState.externalIngestEnablement === ExternalIngestEnablement.DisabledByPolicy;
		const externalIngestDisabledInWorkspace = state.remoteIndexState.externalIngestEnablement === ExternalIngestEnablement.DisabledBySetting;
		const noRepos = state.remoteIndexState.repos.length === 0;

		this._writeStatusItem({
			primary: {
				message: externalIngestDisabledByPolicy || externalIngestDisabledInWorkspace ? t`Disabled` : t`Not available`,
				icon: (externalIngestDisabledByPolicy || externalIngestDisabledInWorkspace) && !noRepos ? warningCodicon : errorCodicon,
			},
			details: externalIngestDisabledByPolicy || externalIngestDisabledInWorkspace ? {
				message: externalIngestDisabledByPolicy
					? noRepos ? externalIngestPolicyNoReposDetail : externalIngestPolicyDetail
					: noRepos ? externalIngestDisabledInWorkspaceNoReposDetail : externalIngestDisabledInWorkspaceDetail,
				busy: false,
			} : undefined,
			tooltip: externalIngestDisabledByPolicy
				? t`External ingest is disabled by your organization's policy.`
				: externalIngestDisabledInWorkspace
					? t`External ingest is disabled in this workspace.`
					: t`This repository can't be indexed. It may be too large or not supported.`,
		});
	}

	private _writeStatusItem(values: ChatStatusItemState | undefined) {
		this._logService.trace(`ChatStatusWorkspaceIndexingStatus::_writeStatusItem()`);

		if (!values) {
			this._statusItem.hide();
			return;
		}

		this._statusItem.show();

		this._statusItem.title = {
			label: statusTitle,
			link: codebaseSemanticSearchDocsLink,
			helpText: t`Indexes your codebase for more relevant AI results.`,
		};

		this._statusItem.description = coalesce([
			values.primary.icon,
			values.primary.message,
			values.primary.busy ? spinnerCodicon : undefined,
		]).join(' ');

		if (values.details) {
			this._statusItem.detail = coalesce([
				values.details.message,
				values.details.busy ? spinnerCodicon : undefined
			]).join(' ');
		} else {
			this._statusItem.detail = '';
		}

		this._statusItem.tooltip = values.tooltip;
	}

	private registerCommands(): IDisposable {
		const disposables = new DisposableStore();

		disposables.add(vscode.commands.registerCommand(reauthenticateCommandId, async (repo: ResolvedRepoRemoteInfo | undefined) => {
			if (!repo) {
				return;
			}

			return this._codeSearchAuthService.tryReauthenticating(repo);
		}));

		return disposables;
	}
}

