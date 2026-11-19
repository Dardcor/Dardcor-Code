/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const VSCODE_AGENT_HOST_MANAGEMENT_SOCKET_ENV = 'VSCODE_AGENT_HOST_MANAGEMENT_SOCKET';

export interface IUpgradeRequestResponse {
	readonly ok: boolean;
	readonly upgradeNeeded?: boolean;
	readonly upgradeStarted?: boolean;
	readonly runningCommit?: string | null;
	readonly latestCommit?: string;
	readonly restartDelayMs?: number;
	readonly error?: string;
}

export function getAgentHostManagementSocketPath(): string | undefined {
	const value = process.env[VSCODE_AGENT_HOST_MANAGEMENT_SOCKET_ENV];
	return value && value.length > 0 ? value : undefined;
}

export async function requestAgentHostUpgrade(socketPath = getAgentHostManagementSocketPath()): Promise<IUpgradeRequestResponse> {
	const http = await import('http');

	if (!socketPath) {
		return Promise.reject(new Error(`Cannot request upgrade: ${VSCODE_AGENT_HOST_MANAGEMENT_SOCKET_ENV} is not set.`));
	}
	return new Promise<IUpgradeRequestResponse>((resolve, reject) => {
		const req = http.request({
			socketPath,
			method: 'POST',
			path: '/upgrade',
			headers: { 'content-length': '0' },
		}, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (chunk: Buffer) => chunks.push(chunk));
			res.on('end', () => {
				const body = Buffer.concat(chunks).toString('utf8');
				const status = res.statusCode ?? 0;
				let parsed: IUpgradeRequestResponse | undefined;
				try {
					parsed = body ? JSON.parse(body) as IUpgradeRequestResponse : undefined;
				} catch {
				}
				if (status >= 200 && status < 300 && parsed && parsed.ok !== false) {
					resolve(parsed);
				} else {
					const reason = parsed?.error || body || `HTTP ${status}`;
					reject(new Error(`Agent host upgrade request failed: ${reason}`));
				}
			});
			res.on('error', reject);
		});
		req.once('error', reject);
		req.end();
	});
}
