/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { dirname } from '../../../base/common/path.js';
import { hasKey } from '../../../base/common/types.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { AgentHostConfigKey, agentHostCustomizationConfigSchema, defaultAgentHostCustomizationConfigValues } from '../common/agentHostCustomizationConfig.js';
import { getAgentCustomizationSettingsEntries, getProviderBackedRootConfigKeys, withAgentCustomizationSettings, type IAgentCustomizationSettingsRegistration } from '../common/agentCustomizationSettings.js';
import { copilotCliConfigSchema } from '../common/copilotCliConfig.js';
import { agentMergeRootConfigSchema } from '../common/agentMerge.js';
import { sandboxConfigSchema } from '../common/sandboxConfigSchema.js';
import { agentHostProxyConfigSchema, clientOwnedApprovalRootConfigKeys, platformRootSchema, type ISchema, type SchemaDefinition, type SchemaValue } from '../common/agentHostSchema.js';
import { ProtocolError } from '../common/state/sessionProtocol.js';
import { ActionType, type ActionOrigin } from '../common/state/sessionActions.js';
import { isAhpChatChannel, parseSubagentSessionUri, ROOT_STATE_URI, type URI as ProtocolURI } from '../common/state/sessionState.js';
import { AgentHostStateManager } from './agentHostStateManager.js';

export const IAgentConfigurationService = createDecorator<IAgentConfigurationService>('agentConfigurationService');

export function getEffectiveWorkingDirectory(stateManager: AgentHostStateManager, session: ProtocolURI): string | undefined {
	const own = stateManager.getSessionState(session)?.workingDirectories?.[0];
	if (own !== undefined) {
		return own;
	}
	const parentInfo = parseSubagentSessionUri(session);
	if (parentInfo) {
		return stateManager.getSessionState(parentInfo.parentSession.toString())?.workingDirectories?.[0];
	}
	return undefined;
}

export function getEffectiveWorkingDirectories(stateManager: AgentHostStateManager, session: ProtocolURI): string[] | undefined {
	const own = stateManager.getSessionState(session)?.workingDirectories;
	if (own !== undefined) {
		return own;
	}
	const parentInfo = parseSubagentSessionUri(session);
	if (parentInfo) {
		return stateManager.getSessionState(parentInfo.parentSession.toString())?.workingDirectories;
	}
	return undefined;
}

export interface IAgentSessionConfigurationChangeEvent {
	readonly session: ProtocolURI;
	readonly config: Record<string, unknown>;
	readonly origin: ActionOrigin | undefined;
}

export interface IAgentConfigurationService {
	readonly _serviceBrand: undefined;

	readonly onDidRootConfigChange: Event<void>;

	readonly onDidSessionConfigChange: Event<IAgentSessionConfigurationChangeEvent>;

	getEffectiveValue<D extends SchemaDefinition, K extends keyof D & string>(
		session: ProtocolURI,
		schema: ISchema<D>,
		key: K,
	): SchemaValue<D[K]> | undefined;

	getEffectiveWorkingDirectories(session: ProtocolURI): readonly string[] | undefined;

	updateSessionConfig(session: ProtocolURI, patch: Record<string, unknown>): void;

	getSessionConfigValues(session: ProtocolURI): Record<string, unknown> | undefined;

	getRootValue<D extends SchemaDefinition, K extends keyof D & string>(
		schema: ISchema<D>,
		key: K,
	): SchemaValue<D[K]> | undefined;

	updateRootConfig(patch: Record<string, unknown>, replace?: boolean): void;

	persistRootConfig(): void;

	whenIdle(): Promise<void>;

	registerProviderConfiguration?(registration: IAgentCustomizationSettingsRegistration): void;
	getRootConfigValues?(): Readonly<Record<string, unknown>>;
	publishRootTransientValues?(patch: Readonly<Record<string, unknown>>): void;
}

export class AgentConfigurationService extends Disposable implements IAgentConfigurationService {
	declare readonly _serviceBrand: undefined;
	private _rootConfigWrite = Promise.resolve();
	private readonly _rootTransientValueKeys = new Set<string>();

	private readonly _onDidRootConfigChange = this._register(new Emitter<void>());
	readonly onDidRootConfigChange: Event<void> = this._onDidRootConfigChange.event;
	private readonly _onDidSessionConfigChange = this._register(new Emitter<IAgentSessionConfigurationChangeEvent>());
	readonly onDidSessionConfigChange: Event<IAgentSessionConfigurationChangeEvent> = this._onDidSessionConfigChange.event;

	constructor(
		private readonly _stateManager: AgentHostStateManager,
		@ILogService private readonly _logService: ILogService,
		private readonly _rootConfigResource?: URI,
		providerConfigurations: readonly IAgentCustomizationSettingsRegistration[] = [],
	) {
		super();
		const existing = this._stateManager.rootState.config;
		const ownSchema = agentHostCustomizationConfigSchema.toProtocol();
		const sandboxSchema = sandboxConfigSchema.toProtocol();
		const copilotCliSchema = copilotCliConfigSchema.toProtocol();
		const agentMergeSchema = agentMergeRootConfigSchema.toProtocol();
		this._stateManager.rootState.config = {
			schema: {
				type: 'object',
				properties: { ...existing?.schema.properties, ...ownSchema.properties, ...sandboxSchema.properties, ...copilotCliSchema.properties, ...agentMergeSchema.properties },
			},
			values: { ...existing?.values, ...this._loadPersistedRootConfig() },
		};
		for (const registration of providerConfigurations) {
			this.registerProviderConfiguration(registration);
		}

		this._register(this._stateManager.onDidEmitEnvelope(envelope => {
			if (envelope.action.type === ActionType.RootConfigChanged) {
				this._onDidRootConfigChange.fire();
			} else if (envelope.action.type === ActionType.SessionConfigChanged) {
				this._onDidSessionConfigChange.fire({
					session: envelope.channel,
					config: envelope.action.config,
					origin: envelope.origin,
				});
			}
		}));
	}

	getEffectiveValue<D extends SchemaDefinition, K extends keyof D & string>(
		session: ProtocolURI,
		schema: ISchema<D>,
		key: K,
	): SchemaValue<D[K]> | undefined {
		for (const values of this._effectiveChain(session)) {
			const raw = values[key];
			if (raw === undefined) {
				continue;
			}
			try {
				schema.assertValid(key, raw);
				return raw;
			} catch (err) {
				const reason = err instanceof ProtocolError ? err.message : String(err);
				this._logService.warn(`[AgentConfigurationService] Value for '${key}' on ${session} failed schema validation, falling back: ${reason}`);
			}
		}
		return undefined;
	}

	getEffectiveWorkingDirectories(session: ProtocolURI): readonly string[] | undefined {
		return getEffectiveWorkingDirectories(this._stateManager, session);
	}

	updateSessionConfig(session: ProtocolURI, patch: Record<string, unknown>): void {
		this._stateManager.dispatchServerAction(session, {
			type: ActionType.SessionConfigChanged,
			config: patch,
		});
	}

	getSessionConfigValues(session: ProtocolURI): Record<string, unknown> | undefined {
		if (isAhpChatChannel(session)) {
			throw new Error(`Expected a session URI, received chat channel ${session}`);
		}
		return this._stateManager.getSessionState(session)?.config?.values;
	}

	getRootValue<D extends SchemaDefinition, K extends keyof D & string>(
		schema: ISchema<D>,
		key: K,
	): SchemaValue<D[K]> | undefined {
		const root = this._stateManager.rootState.config?.values;
		const raw = root?.[key];
		if (raw === undefined) {
			return undefined;
		}
		try {
			schema.assertValid(key, raw);
			return raw;
		} catch (err) {
			const reason = err instanceof ProtocolError ? err.message : String(err);
			this._logService.warn(`[AgentConfigurationService] Host value for '${key}' failed schema validation, ignoring: ${reason}`);
			return undefined;
		}
	}

	updateRootConfig(patch: Record<string, unknown>, replace = false): void {
		this._stateManager.dispatchServerAction(ROOT_STATE_URI, {
			type: ActionType.RootConfigChanged,
			config: patch,
			replace,
		});
		this.persistRootConfig();
	}

	persistRootConfig(): void {
		if (!this._rootConfigResource) {
			return;
		}

		const values = { ...(this._stateManager.rootState.config?.values ?? { [AgentHostConfigKey.Customizations]: [] }) };
		for (const key of this._rootTransientValueKeys) {
			delete values[key];
		}
		for (const key of getProviderBackedRootConfigKeys(this._stateManager.rootState)) {
			delete values[key];
		}
		const content = JSON.stringify(values, undefined, '\t');
		const resource = this._rootConfigResource;

		this._rootConfigWrite = this._rootConfigWrite
			.catch(err => {
				this._logService.warn('[AgentConfigurationService] Previous host config write failed', err);
			})
			.then(async () => {
				await fs.promises.mkdir(dirname(resource.fsPath), { recursive: true });
				await fs.promises.writeFile(resource.fsPath, `${content}\n`, 'utf8');
			})
			.catch(err => {
				this._logService.error(`[AgentConfigurationService] Failed to persist host config to ${resource.fsPath}`, err);
			});
	}

	async whenIdle(): Promise<void> {
		await this._rootConfigWrite;
	}

	registerProviderConfiguration(registration: IAgentCustomizationSettingsRegistration): void {
		const config = this._stateManager.rootState.config;
		if (!config) {
			return;
		}
		Object.assign(config.schema.properties, registration.properties);
		for (const [key, property] of Object.entries(registration.properties)) {
			if (config.values[key] === undefined && property.default !== undefined) {
				config.values[key] = property.default;
			}
		}
		const registrations = getAgentCustomizationSettingsEntries(this._stateManager.rootState).filter(entry => entry.provider !== registration.provider);
		this._stateManager.rootState._meta = withAgentCustomizationSettings(this._stateManager.rootState, [...registrations, {
			provider: registration.provider,
			title: registration.title,
			description: registration.description,
			settings: registration.settings,
			configurationFile: registration.configurationFile,
		}]);
	}

	getRootConfigValues(): Readonly<Record<string, unknown>> {
		return this._stateManager.rootState.config?.values ?? {};
	}

	publishRootTransientValues(patch: Readonly<Record<string, unknown>>): void {
		for (const key of Object.keys(patch)) {
			this._rootTransientValueKeys.add(key);
		}
		this._stateManager.dispatchServerAction(ROOT_STATE_URI, {
			type: ActionType.RootConfigChanged,
			config: { ...patch },
		});
	}

	private *_effectiveChain(session: ProtocolURI): Iterable<Record<string, unknown>> {
		const own = this._stateManager.getSessionState(session)?.config?.values;
		if (own) {
			yield own;
		}
		const parentInfo = parseSubagentSessionUri(session);
		if (parentInfo) {
			const parent = this._stateManager.getSessionState(parentInfo.parentSession.toString())?.config?.values;
			if (parent) {
				yield parent;
			}
		}
		const host = this._stateManager.rootState.config?.values;
		if (host) {
			yield host;
		}
	}

	private _loadPersistedRootConfig(): Record<string, unknown> {
		const defaults = defaultAgentHostCustomizationConfigValues;
		if (!this._rootConfigResource) {
			return { ...defaults };
		}

		try {
			const raw = fs.readFileSync(this._rootConfigResource.fsPath, 'utf8');
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			return {
				...this._loadPersistedPlatformRootConfig(parsed),
				...agentHostCustomizationConfigSchema.validateOrDefault(parsed, defaults),
				...sandboxConfigSchema.validateOrDefault(parsed, {}),
				...copilotCliConfigSchema.validateOrDefault(parsed, {}),
				...agentMergeRootConfigSchema.validateOrDefault(parsed, {}),
				...agentHostProxyConfigSchema.validateOrDefault(parsed, {}),
			};
		} catch (err) {
			const code = err && typeof err === 'object' && hasKey(err, { code: true }) ? String(err.code) : undefined;
			if (code !== 'ENOENT') {
				this._logService.warn(`[AgentConfigurationService] Failed to read host config from ${this._rootConfigResource.fsPath}: ${err instanceof Error ? err.message : String(err)}`);
			}
			return { ...defaults };
		}
	}

	private _loadPersistedPlatformRootConfig(parsed: Record<string, unknown>): Record<string, unknown> {
		const values: Record<string, unknown> = { ...platformRootSchema.validateOrDefault(parsed, {}) };
		for (const key of clientOwnedApprovalRootConfigKeys) {
			delete values[key];
		}
		return values;
	}
}
