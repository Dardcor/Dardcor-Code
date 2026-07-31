/**
 * Dardcor Code - IPC Channel Router
 */

import { IChannelRouter } from './channel.js';

export class IPCChannelRouter implements IChannelRouter {
	private readonly _routes = new Map<string, string>();

	public registerRoute(commandPrefix: string, targetChannel: string): void {
		this._routes.set(commandPrefix, targetChannel);
	}

	public route(command: string, _arg?: any): string {
		for (const [prefix, channel] of this._routes.entries()) {
			if (command.startsWith(prefix)) {
				return channel;
			}
		}
		return 'default';
	}
}
