/**
 * Dardcor Code - dc.env API Bridge (Task 622)
 * Mirrors: vs/workbench/api/common/extHostEnv.ts
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { RPCProtocol } from '../host/rpc-protocol';
import { generateUuid } from '../../core/types/uuid';
import { URI } from '../../core/types/uri';

export enum UIKind {
	Desktop = 1,
	Web = 2
}

export interface IEnvApi {
	readonly machineId: string;
	readonly sessionId: string;
	readonly appName: string;
	readonly appHost: string;
	readonly uriScheme: string;
	readonly appRoot: string;
	readonly language: string;
	readonly uiKind: UIKind;
	readonly remoteName: string | undefined;
	readonly shell: string | undefined;
	readonly isNewAppInstall: boolean;
	readonly clipboard: {
		readText(): Promise<string>;
		writeText(value: string): Promise<void>;
	};
	openExternal(target: URI): Promise<boolean>;
	asExternalUri(target: URI): Promise<URI>;
}

/**
 * Environment bridge. Identifiers are generated locally; operations that
 * require the OS/main process (clipboard, external URLs) go over RPC.
 */
export class ExtHostEnv extends Disposable {
	private readonly _machineId = generateUuid();
	private readonly _sessionId = generateUuid();

	constructor(private readonly _rpc: RPCProtocol) {
		super();
	}

	public get api(): IEnvApi {
		const self = this;
		return {
			get machineId() {
				return self._machineId;
			},
			get sessionId() {
				return self._sessionId;
			},
			get appName() {
				return 'Dardcor Code';
			},
			get appHost() {
				return 'desktop';
			},
			get uriScheme() {
				return 'file';
			},
			get appRoot() {
				return '';
			},
			get language() {
				return 'en';
			},
			get uiKind() {
				return UIKind.Desktop;
			},
			get remoteName() {
				return undefined;
			},
			get shell() {
				return undefined;
			},
			get isNewAppInstall() {
				return false;
			},
			clipboard: {
				readText: () => self._rpc.call<string>('main', 'env.readClipboard', {}),
				writeText: (value: string) => self._rpc.call('main', 'env.writeClipboard', { value })
			},
			openExternal: (target: URI) => self._rpc.call<boolean>('main', 'env.openExternal', { uri: target.toString() }),
			asExternalUri: async (target: URI) => {
				const result = await self._rpc.call<string | undefined>('main', 'env.asExternalUri', { uri: target.toString() });
				return result ? URI.parse(result) : target;
			}
		};
	}
}
