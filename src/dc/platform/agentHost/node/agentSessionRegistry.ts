/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Limiter } from '../../../base/common/async.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { AgentProvider } from '../common/agent.js';
import { AgentSessionRegistrationSource, IAgentHostDatabase, IAgentHostDatabaseExternalUpdate, IAgentHostDatabaseRegisterOptions, IAgentHostDatabaseSessionOptions } from './agentHostDatabase.js';

export interface IRegisteredSession {
	readonly session: URI;
	readonly provider: AgentProvider;
	readonly startTime: number;
	readonly modifiedTime: number;
	readonly external: boolean;
	readonly source: AgentSessionRegistrationSource;
}

export interface IStoredRegisteredSession extends Omit<IRegisteredSession, 'external'> {
	readonly external: boolean | undefined;
}

export type RegisteredSessionMigration = (entry: IStoredRegisteredSession) => Promise<IRegisteredSession | undefined>;
































export class AgentSessionRegistry extends Disposable {

	constructor(private readonly _database: IAgentHostDatabase) {
		super();
	}

	register(session: URI, sessionOptions: IAgentHostDatabaseSessionOptions, registerOptions: IAgentHostDatabaseRegisterOptions): Promise<boolean> {
		return this._database.registerSession(session.toString(), sessionOptions, registerOptions);
	}

	async unregister(session: URI): Promise<void> {
		await this._database.unregisterSession(session.toString());
	}

	async tombstone(session: URI): Promise<void> {
		await this._database.tombstoneAndUnregisterSession(session.toString());
	}

	updateModifiedTime(session: URI, modifiedTime: number): Promise<boolean> {
		return this._database.updateSessionModifiedTime(session.toString(), modifiedTime);
	}

	updateModifiedTimes(updates: readonly { readonly session: URI; readonly modifiedTime: number }[]): Promise<void> {
		return this._database.updateSessionModifiedTimes(updates.map(({ session, modifiedTime }) => ({ session: session.toString(), modifiedTime })));
	}

	async listSessionKeys(): Promise<ReadonlySet<string>> {
		return new Set((await this._database.listSessions()).map(entry => entry.session));
	}

	async listSessionModifiedTimes(): Promise<ReadonlyMap<string, number>> {
		return new Map((await this._database.listSessions()).map(entry => [entry.session, entry.modifiedTime]));
	}

	async list(migrate?: RegisteredSessionMigration): Promise<IRegisteredSession[]> {
		const entries: IStoredRegisteredSession[] = (await this._database.listSessions()).map(entry => ({
			session: URI.parse(entry.session),
			provider: entry.provider,
			startTime: entry.startTime,
			modifiedTime: entry.modifiedTime,
			external: entry.external,
			source: entry.source,
		}));
		const limiter = new Limiter<IRegisteredSession | undefined>(4);
		const migrations: readonly (IRegisteredSession | undefined)[] = migrate
			? await Promise.all(entries.map(entry => limiter.queue(() => migrate(entry))))
			: entries.map(() => undefined);
		const updates: IAgentHostDatabaseExternalUpdate[] = [];
		const result = entries.map((entry, index): IRegisteredSession => {
			const migrated = migrations[index];
			if (migrated) {
				updates.push({
					session: migrated.session.toString(),
					external: migrated.external,
				});
				return migrated;
			}
			if (entry.external === undefined) {
				throw new Error(`Session migration did not resolve registry entry ${entry.session.toString()}`);
			}
			return {
				...entry,
				external: entry.external,
			};
		});
		if (updates.length > 0) {
			await this._database.updateSessionExternal(updates);
		}
		return result;
	}

	async get(session: URI, migrate?: RegisteredSessionMigration): Promise<IRegisteredSession | undefined> {
		const stored = await this._database.getSession(session.toString());
		if (!stored) {
			return undefined;
		}
		const entry: IStoredRegisteredSession = {
			session: URI.parse(stored.session),
			provider: stored.provider,
			startTime: stored.startTime,
			modifiedTime: stored.modifiedTime,
			external: stored.external,
			source: stored.source,
		};
		const migrated = await migrate?.(entry);
		if (migrated) {
			await this._database.updateSessionExternal([{ session: migrated.session.toString(), external: migrated.external }]);
			return migrated;
		}
		if (entry.external === undefined) {
			throw new Error(`Session migration did not resolve registry entry ${entry.session.toString()}`);
		}
		return {
			...entry,
			external: entry.external,
		};
	}

	async isEmpty(): Promise<boolean> {
		return this._database.isSessionRegistryEmpty();
	}

	/**
	 * @deprecated legacy global one-shot marker, retained for reading databases
	 * written before per-provider tracking existed; see
	 * {@link isProviderBackfilled} for per-provider discovery diagnostics.
	 */
	async isBackfilled(): Promise<boolean> {
		return this._database.isSessionRegistryBackfilled();
	}

	/**
	 * @deprecated legacy global one-shot marker; see {@link markProviderBackfilled}.
	 * Not invoked by the per-provider backfill sweep — see the class doc comment.
	 */
	async markBackfilled(): Promise<void> {
		await this._database.markSessionRegistryBackfilled();
	}

	async isProviderBackfilled(provider: AgentProvider): Promise<boolean> {
		return this._database.isProviderBackfilled(provider);
	}

	async markProviderBackfilled(provider: AgentProvider): Promise<void> {
		await this._database.markProviderBackfilled(provider);
	}

	async isTombstoned(session: URI): Promise<boolean> {
		return this._database.isSessionTombstoned(session.toString());
	}

	async clearTombstone(session: URI): Promise<void> {
		await this._database.clearSessionTombstone(session.toString());
	}

	async setAgentMergeEnabled(session: URI, enabled: boolean): Promise<void> {
		await this._database.setSessionAgentMergeEnabled(session.toString(), enabled);
	}

	async listAgentMergeEnabled(): Promise<readonly URI[]> {
		const sessions = await this._database.listAgentMergeEnabledSessions();
		return sessions.map(session => URI.parse(session));
	}
}
