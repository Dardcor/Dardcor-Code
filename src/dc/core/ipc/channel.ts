/**
 * Dardcor Code - IPC Channel Interfaces & Primitives
 */

import { Event } from '../events/emitter';

export interface IChannel {
	call<T>(command: string, arg?: any): Promise<T>;
	listen<T>(event: string, arg?: any): Event<T>;
}

export interface IServerChannel {
	call<T>(ctx: any, command: string, arg?: any): Promise<T>;
	listen<T>(ctx: any, event: string, arg?: any): Event<T>;
}

export interface IChannelRouter {
	route(command: string, arg?: any): string;
}
