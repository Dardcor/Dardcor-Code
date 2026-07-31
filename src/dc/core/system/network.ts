/**
 * Dardcor Code - Network Fetch Transport Abstraction
 */

export interface NetworkResponse {
	status: number;
	ok: boolean;
	text(): Promise<string>;
	json<T = any>(): Promise<T>;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export namespace Network {
	export async function fetch(url: string, init?: RequestInit): Promise<NetworkResponse> {
		if (typeof globalThis.fetch === 'function') {
			const res = await globalThis.fetch(url, init);
			return {
				status: res.status,
				ok: res.ok,
				text: () => res.text(),
				json: () => res.json(),
				arrayBuffer: () => res.arrayBuffer()
			};
		}
		throw new Error('Fetch API not supported in current environment');
	}
}
