/**
 * Dardcor Code - Custom Heartbeat Ping Payload Protocol (Task 833)
 */

export const HEARTBEAT_PING = 'heartbeat.ping';
export const HEARTBEAT_PONG = 'heartbeat.pong';

export interface HeartbeatPayload {
	readonly type: typeof HEARTBEAT_PING | typeof HEARTBEAT_PONG;
	readonly t: number;
	readonly seq: number;
}

export function encodeHeartbeatPing(seq: number, now: number = Date.now()): string {
	return JSON.stringify({ type: HEARTBEAT_PING, t: now, seq });
}

export function encodeHeartbeatPong(seq: number, now: number = Date.now()): string {
	return JSON.stringify({ type: HEARTBEAT_PONG, t: now, seq });
}

export function isHeartbeatMessage(message: string): boolean {
	return message.startsWith(HEARTBEAT_PING) || message.startsWith(HEARTBEAT_PONG);
}

export function decodeHeartbeat(message: string): HeartbeatPayload | undefined {
	if (!isHeartbeatMessage(message)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(message) as Partial<HeartbeatPayload>;
		if (parsed && typeof parsed.t === 'number' && typeof parsed.seq === 'number') {
			return parsed as HeartbeatPayload;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

export function createHeartbeatPing(seq: number): HeartbeatPayload {
	return { type: HEARTBEAT_PING, t: Date.now(), seq };
}

export function createHeartbeatPong(ping: HeartbeatPayload): HeartbeatPayload {
	return { type: HEARTBEAT_PONG, t: Date.now(), seq: ping.seq };
}

export function computeRoundTripTime(ping: HeartbeatPayload, pong: HeartbeatPayload): number {
	return Math.max(0, pong.t - ping.t);
}
