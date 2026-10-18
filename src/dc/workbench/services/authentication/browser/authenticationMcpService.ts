/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, dispose, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { scopesMatch } from '../../../../base/common/oauth.js';
import * as nls from '../../../../nls.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IActivityService, NumberBadge } from '../../activity/common/activity.js';
import { IAuthenticationMcpAccessService } from './authenticationMcpAccessService.js';
import { IAuthenticationMcpUsageService } from './authenticationMcpUsageService.js';
import { AuthenticationSession, IAuthenticationProvider, IAuthenticationService, AuthenticationSessionAccount } from '../common/authentication.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

const SCOPESLIST_SEPARATOR = ' ';

interface SessionRequest {
	disposables: IDisposable[];
	requestingMcpServerIds: string[];
}

interface SessionRequestInfo {
	[scopesList: string]: SessionRequest;
}

export const IAuthenticationMcpService = createDecorator<IAuthenticationMcpService>('IAuthenticationMcpService');
export interface IAuthenticationMcpService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeAccountPreference: Event<{ mcpServerIds: string[]; providerId: string }>;
	getAccountPreference(mcpServerId: string, providerId: string): string | undefined;
	updateAccountPreference(mcpServerId: string, providerId: string, account: AuthenticationSessionAccount): void;
	removeAccountPreference(mcpServerId: string, providerId: string): void;
	updateSessionPreference(providerId: string, mcpServerId: string, session: AuthenticationSession): void;
	getSessionPreference(providerId: string, mcpServerId: string, scopes: string[]): string | undefined;
	removeSessionPreference(providerId: string, mcpServerId: string, scopes: string[]): void;
	selectSession(providerId: string, mcpServerId: string, mcpServerName: string, scopes: string[], possibleSessions: readonly AuthenticationSession[]): Promise<AuthenticationSession>;
	requestSessionAccess(providerId: string, mcpServerId: string, mcpServerName: string, scopes: string[], possibleSessions: readonly AuthenticationSession[]): void;
	requestNewSession(providerId: string, scopes: string[], mcpServerId: string, mcpServerName: string): Promise<void>;
}

export class AuthenticationMcpService extends Disposable implements IAuthenticationMcpService {
	declare readonly _serviceBrand: undefined;
	private _signInRequestItems = new Map<string, SessionRequestInfo>();
	private _sessionAccessRequestItems = new Map<string, { [mcpServerId: string]: { disposables: IDisposable[]; possibleSessions: AuthenticationSession[] } }>();
	private readonly _accountBadgeDisposable = this._register(new MutableDisposable());

	private _onDidAccountPreferenceChange: Emitter<{ providerId: string; mcpServerIds: string[] }> = this._register(new Emitter<{ providerId: string; mcpServerIds: string[] }>());
	readonly onDidChangeAccountPreference = this._onDidAccountPreferenceChange.event;

	private _inheritAuthAccountPreferenceParentToChildren: Record<string, string[]>;
	private _inheritAuthAccountPreferenceChildToParent: { [mcpServerId: string]: string };

	constructor(
		@IActivityService private readonly activityService: IActivityService,
		@IStorageService private readonly storageService: IStorageService,
		@IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IProductService private readonly _productService: IProductService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IAuthenticationMcpUsageService private readonly _authenticationUsageService: IAuthenticationMcpUsageService,
		@IAuthenticationMcpAccessService private readonly _authenticationAccessService: IAuthenticationMcpAccessService
	) {
		super();
		this._inheritAuthAccountPreferenceParentToChildren = this._productService.inheritAuthAccountPreference || {};
		this._inheritAuthAccountPreferenceChildToParent = Object.entries(this._inheritAuthAccountPreferenceParentToChildren).reduce<{ [mcpServerId: string]: string }>((acc, [parent, children]) => {
			children.forEach((child: string) => {
				acc[child] = parent;
			});
			return acc;
		}, {});
		this.registerListeners();
	}

	private registerListeners() {
		this._register(this._authenticationService.onDidChangeSessions(async e => {
			if (e.event.added?.length) {
				await this.updateNewSessionRequests(e.providerId, e.event.added);
			}
			if (e.event.removed?.length) {
				await this.updateAccessRequests(e.providerId, e.event.removed);
			}
			this.updateBadgeCount();
		}));

		this._register(this._authenticationService.onDidUnregisterAuthenticationProvider(e => {
			const accessRequests = this._sessionAccessRequestItems.get(e.id) || {};
			Object.keys(accessRequests).forEach(mcpServerId => {
				this.removeAccessRequest(e.id, mcpServerId);
			});
		}));
	}

	private async updateNewSessionRequests(providerId: string, addedSessions: readonly AuthenticationSession[]): Promise<void> {
		const existingRequestsForProvider = this._signInRequestItems.get(providerId);
		if (!existingRequestsForProvider) {
			return;
		}

		Object.keys(existingRequestsForProvider).forEach(requestedScopes => {
			const requestedScopesArray = requestedScopes.split(SCOPESLIST_SEPARATOR);

			if (addedSessions.some(session => scopesMatch(session.scopes, requestedScopesArray))) {
				const sessionRequest = existingRequestsForProvider[requestedScopes];
				sessionRequest?.disposables.forEach(item => item.dispose());

				delete existingRequestsForProvider[requestedScopes];
				if (Object.keys(existingRequestsForProvider).length === 0) {
					this._signInRequestItems.delete(providerId);
				} else {
					this._signInRequestItems.set(providerId, existingRequestsForProvider);
				}
			}
		});
	}

	private async updateAccessRequests(providerId: string, removedSessions: readonly AuthenticationSession[]) {
		const providerRequests = this._sessionAccessRequestItems.get(providerId);
		if (providerRequests) {
			Object.keys(providerRequests).forEach(mcpServerId => {
				removedSessions.forEach(removed => {
					const indexOfSession = providerRequests[mcpServerId].possibleSessions.findIndex(session => session.id === removed.id);
					if (indexOfSession) {
						providerRequests[mcpServerId].possibleSessions.splice(indexOfSession, 1);
					}
				});

				if (!providerRequests[mcpServerId].possibleSessions.length) {
					this.removeAccessRequest(providerId, mcpServerId);
				}
			});
		}
	}

	private updateBadgeCount(): void {
		this._accountBadgeDisposable.clear();

		let numberOfRequests = 0;
		this._signInRequestItems.forEach(providerRequests => {
			Object.keys(providerRequests).forEach(request => {
				numberOfRequests += providerRequests[request].requestingMcpServerIds.length;
			});
		});

		this._sessionAccessRequestItems.forEach(accessRequest => {
			numberOfRequests += Object.keys(accessRequest).length;
		});

		if (numberOfRequests > 0) {
			const badge = new NumberBadge(numberOfRequests, () => nls.localize('sign in', "Sign in requested"));
			this._accountBadgeDisposable.value = this.activityService.showAccountsActivity({ badge });
		}
	}

	private removeAccessRequest(providerId: string, mcpServerId: string): void {
		const providerRequests = this._sessionAccessRequestItems.get(providerId) || {};
		if (providerRequests[mcpServerId]) {
			dispose(providerRequests[mcpServerId].disposables);
			delete providerRequests[mcpServerId];
			this.updateBadgeCount();
		}
	}


	updateAccountPreference(mcpServerId: string, providerId: string, account: AuthenticationSessionAccount): void {
		const parentMcpServerId = this._inheritAuthAccountPreferenceChildToParent[mcpServerId] ?? mcpServerId;
		const key = this._getKey(parentMcpServerId, providerId);


		this.storageService.store(key, account.label, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this.storageService.store(key, account.label, StorageScope.APPLICATION, StorageTarget.MACHINE);

		const childrenMcpServers = this._inheritAuthAccountPreferenceParentToChildren[parentMcpServerId];
		const mcpServerIds = childrenMcpServers ? [parentMcpServerId, ...childrenMcpServers] : [parentMcpServerId];
		this._onDidAccountPreferenceChange.fire({ mcpServerIds, providerId });
	}

	getAccountPreference(mcpServerId: string, providerId: string): string | undefined {
		const key = this._getKey(this._inheritAuthAccountPreferenceChildToParent[mcpServerId] ?? mcpServerId, providerId);


		return this.storageService.get(key, StorageScope.WORKSPACE) ?? this.storageService.get(key, StorageScope.APPLICATION);
	}

	removeAccountPreference(mcpServerId: string, providerId: string): void {
		const key = this._getKey(this._inheritAuthAccountPreferenceChildToParent[mcpServerId] ?? mcpServerId, providerId);


		this.storageService.remove(key, StorageScope.WORKSPACE);
		this.storageService.remove(key, StorageScope.APPLICATION);
	}

	private _getKey(mcpServerId: string, providerId: string): string {
		return `${mcpServerId}-${providerId}`;
	}


	updateSessionPreference(providerId: string, mcpServerId: string, session: AuthenticationSession): void {
		const key = `${mcpServerId}-${providerId}-${session.scopes.join(SCOPESLIST_SEPARATOR)}`;


		this.storageService.store(key, session.id, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this.storageService.store(key, session.id, StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	getSessionPreference(providerId: string, mcpServerId: string, scopes: string[]): string | undefined {
		const key = `${mcpServerId}-${providerId}-${scopes.join(SCOPESLIST_SEPARATOR)}`;


		return this.storageService.get(key, StorageScope.WORKSPACE) ?? this.storageService.get(key, StorageScope.APPLICATION);
	}

	removeSessionPreference(providerId: string, mcpServerId: string, scopes: string[]): void {
		const key = `${mcpServerId}-${providerId}-${scopes.join(SCOPESLIST_SEPARATOR)}`;


		this.storageService.remove(key, StorageScope.WORKSPACE);
		this.storageService.remove(key, StorageScope.APPLICATION);
	}

	private _updateAccountAndSessionPreferences(providerId: string, mcpServerId: string, session: AuthenticationSession): void {
		this.updateAccountPreference(mcpServerId, providerId, session.account);
		this.updateSessionPreference(providerId, mcpServerId, session);
	}


	private async showGetSessionPrompt(provider: IAuthenticationProvider, accountName: string, mcpServerId: string, mcpServerName: string): Promise<boolean> {
		enum SessionPromptChoice {
			Allow = 0,
			Deny = 1,
			Cancel = 2
		}
		const { result } = await this.dialogService.prompt<SessionPromptChoice>({
			type: Severity.Info,
			message: nls.localize('confirmAuthenticationAccess', "The MCP server '{0}' wants to access the {1} account '{2}'.", mcpServerName, provider.label, accountName),
			buttons: [
				{
					label: nls.localize({ key: 'allow', comment: ['&& denotes a mnemonic'] }, "&&Allow"),
					run: () => SessionPromptChoice.Allow
				},
				{
					label: nls.localize({ key: 'deny', comment: ['&& denotes a mnemonic'] }, "&&Deny"),
					run: () => SessionPromptChoice.Deny
				}
			],
			cancelButton: {
				run: () => SessionPromptChoice.Cancel
			}
		});

		if (result !== SessionPromptChoice.Cancel) {
			this._authenticationAccessService.updateAllowedMcpServers(provider.id, accountName, [{ id: mcpServerId, name: mcpServerName, allowed: result === SessionPromptChoice.Allow }]);
			this.removeAccessRequest(provider.id, mcpServerId);
		}

		return result === SessionPromptChoice.Allow;
	}

	async selectSession(providerId: string, mcpServerId: string, mcpServerName: string, scopes: string[], availableSessions: AuthenticationSession[]): Promise<AuthenticationSession> {
		const allAccounts = await this._authenticationService.getAccounts(providerId);
		if (!allAccounts.length) {
			throw new Error('No accounts available');
		}
		const disposables = new DisposableStore();
		const quickPick = disposables.add(this.quickInputService.createQuickPick<{ label: string; session?: AuthenticationSession; account?: AuthenticationSessionAccount }>());
		quickPick.ignoreFocusOut = true;
		const accountsWithSessions = new Set<string>();
		const items: { label: string; session?: AuthenticationSession; account?: AuthenticationSessionAccount }[] = availableSessions
			.filter(session => !accountsWithSessions.has(session.account.label) && accountsWithSessions.add(session.account.label))
			.map(session => {
				return {
					label: session.account.label,
					session: session
				};
			});

		allAccounts.forEach(account => {
			if (!accountsWithSessions.has(account.label)) {
				items.push({ label: account.label, account });
			}
		});
		items.push({ label: nls.localize('useOtherAccount', "Sign in to another account") });
		quickPick.items = items;
		quickPick.title = nls.localize(
			{
				key: 'selectAccount',
				comment: ['The placeholder {0} is the name of a MCP server. {1} is the name of the type of account, such as Microsoft or GitHub.']
			},
			"The MCP server '{0}' wants to access a {1} account",
			mcpServerName,
			this._authenticationService.getProvider(providerId).label
		);
		quickPick.placeholder = nls.localize('getSessionPlateholder', "Select an account for '{0}' to use or Esc to cancel", mcpServerName);

		return await new Promise((resolve, reject) => {
			disposables.add(quickPick.onDidAccept(async _ => {
				quickPick.dispose();
				let session = quickPick.selectedItems[0].session;
				if (!session) {
					const account = quickPick.selectedItems[0].account;
					try {
						session = await this._authenticationService.createSession(providerId, scopes, { account });
					} catch (e) {
						reject(e);
						return;
					}
				}
				const accountName = session.account.label;

				this._authenticationAccessService.updateAllowedMcpServers(providerId, accountName, [{ id: mcpServerId, name: mcpServerName, allowed: true }]);
				this._updateAccountAndSessionPreferences(providerId, mcpServerId, session);
				this.removeAccessRequest(providerId, mcpServerId);

				resolve(session);
			}));

			disposables.add(quickPick.onDidHide(_ => {
				if (!quickPick.selectedItems[0]) {
					reject('User did not consent to account access');
				}
				disposables.dispose();
			}));

			quickPick.show();
		});
	}

	private async completeSessionAccessRequest(provider: IAuthenticationProvider, mcpServerId: string, mcpServerName: string, scopes: string[]): Promise<void> {
		const providerRequests = this._sessionAccessRequestItems.get(provider.id) || {};
		const existingRequest = providerRequests[mcpServerId];
		if (!existingRequest) {
			return;
		}

		if (!provider) {
			return;
		}
		const possibleSessions = existingRequest.possibleSessions;

		let session: AuthenticationSession | undefined;
		if (provider.supportsMultipleAccounts) {
			try {
				session = await this.selectSession(provider.id, mcpServerId, mcpServerName, scopes, possibleSessions);
			} catch (_) {
			}
		} else {
			const approved = await this.showGetSessionPrompt(provider, possibleSessions[0].account.label, mcpServerId, mcpServerName);
			if (approved) {
				session = possibleSessions[0];
			}
		}

		if (session) {
			this._authenticationUsageService.addAccountUsage(provider.id, session.account.label, session.scopes, mcpServerId, mcpServerName);
		}
	}

	requestSessionAccess(providerId: string, mcpServerId: string, mcpServerName: string, scopes: string[], possibleSessions: AuthenticationSession[]): void {
		const providerRequests = this._sessionAccessRequestItems.get(providerId) || {};
		const hasExistingRequest = providerRequests[mcpServerId];
		if (hasExistingRequest) {
			return;
		}

		const provider = this._authenticationService.getProvider(providerId);
		const menuItem = MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			group: '3_accessRequests',
			command: {
				id: `${providerId}${mcpServerId}Access`,
				title: nls.localize({
					key: 'accessRequest',
					comment: [`The placeholder {0} will be replaced with an authentication provider''s label. {1} will be replaced with a MCP server name. (1) is to indicate that this menu item contributes to a badge count`]
				},
					"Grant access to {0} for {1}... (1)",
					provider.label,
					mcpServerName)
			}
		});

		const accessCommand = CommandsRegistry.registerCommand({
			id: `${providerId}${mcpServerId}Access`,
			handler: async (accessor) => {
				this.completeSessionAccessRequest(provider, mcpServerId, mcpServerName, scopes);
			}
		});

		providerRequests[mcpServerId] = { possibleSessions, disposables: [menuItem, accessCommand] };
		this._sessionAccessRequestItems.set(providerId, providerRequests);
		this.updateBadgeCount();
	}

	async requestNewSession(providerId: string, scopes: string[], mcpServerId: string, mcpServerName: string): Promise<void> {
		if (!this._authenticationService.isAuthenticationProviderRegistered(providerId)) {
			await new Promise<void>((resolve, _) => {
				const dispose = this._authenticationService.onDidRegisterAuthenticationProvider(e => {
					if (e.id === providerId) {
						dispose.dispose();
						resolve();
					}
				});
			});
		}

		let provider: IAuthenticationProvider;
		try {
			provider = this._authenticationService.getProvider(providerId);
		} catch (_e) {
			return;
		}

		const providerRequests = this._signInRequestItems.get(providerId);
		const scopesList = scopes.join(SCOPESLIST_SEPARATOR);
		const mcpServerHasExistingRequest = providerRequests
			&& providerRequests[scopesList]
			&& providerRequests[scopesList].requestingMcpServerIds.includes(mcpServerId);

		if (mcpServerHasExistingRequest) {
			return;
		}

		const commandId = `${providerId}:${mcpServerId}:signIn${Object.keys(providerRequests || []).length}`;
		const menuItem = MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			group: '2_signInRequests',
			command: {
				id: commandId,
				title: nls.localize({
					key: 'signInRequest',
					comment: [`The placeholder {0} will be replaced with an authentication provider's label. {1} will be replaced with a MCP server name. (1) is to indicate that this menu item contributes to a badge count.`]
				},
					"Sign in with {0} to use {1} (1)",
					provider.label,
					mcpServerName)
			}
		});

		const signInCommand = CommandsRegistry.registerCommand({
			id: commandId,
			handler: async (accessor) => {
				const authenticationService = accessor.get(IAuthenticationService);
				const session = await authenticationService.createSession(providerId, scopes);

				this._authenticationAccessService.updateAllowedMcpServers(providerId, session.account.label, [{ id: mcpServerId, name: mcpServerName, allowed: true }]);
				this._updateAccountAndSessionPreferences(providerId, mcpServerId, session);
			}
		});


		if (providerRequests) {
			const existingRequest = providerRequests[scopesList] || { disposables: [], requestingMcpServerIds: [] };

			providerRequests[scopesList] = {
				disposables: [...existingRequest.disposables, menuItem, signInCommand],
				requestingMcpServerIds: [...existingRequest.requestingMcpServerIds, mcpServerId]
			};
			this._signInRequestItems.set(providerId, providerRequests);
		} else {
			this._signInRequestItems.set(providerId, {
				[scopesList]: {
					disposables: [menuItem, signInCommand],
					requestingMcpServerIds: [mcpServerId]
				}
			});
		}

		this.updateBadgeCount();
	}
}

registerSingleton(IAuthenticationMcpService, AuthenticationMcpService, InstantiationType.Delayed);
