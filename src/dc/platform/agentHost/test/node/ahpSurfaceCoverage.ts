/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from '../../../../base/common/path.js';
import { FileAccess } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';


export type AhpSurfaceKind = 'command' | 'notification' | 'action';

interface IObservedSurface {
	readonly commands: string[];
	readonly notifications: string[];
	readonly actions: string[];
}

const observed: Record<AhpSurfaceKind, Set<string>> = {
	command: new Set<string>(),
	notification: new Set<string>(),
	action: new Set<string>(),
};

let outputPath: string | undefined;
let enabled: boolean | undefined;
let warned = false;

function isEnabled(): boolean {
	if (enabled === undefined) {
		enabled = process.env['AGENT_HOST_RECORD_PROTOCOL_SURFACE'] === '1';
	}
	return enabled;
}

function resolveOutputPath(): string {
	if (!outputPath) {
		const configured = process.env['AGENT_HOST_PROTOCOL_SURFACE_OUT'];
		outputPath = configured
			? configured
			: URI.joinPath(FileAccess.asFileUri(''), '../.build/agent-host-e2e-coverage/protocol-surface/observed.json').fsPath;
	}
	return outputPath;
}

export function recordAhpSurface(kind: AhpSurfaceKind, symbol: string): void {
	if (!isEnabled() || !symbol) {
		return;
	}
	const seen = observed[kind];
	if (seen.has(symbol)) {
		return;
	}
	seen.add(symbol);
	flush();
}

function flush(): void {
	const payload: IObservedSurface = {
		commands: [...observed.command].sort(),
		notifications: [...observed.notification].sort(),
		actions: [...observed.action].sort(),
	};
	try {
		const path = resolveOutputPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(payload, undefined, '\t')}\n`);
	} catch (error) {
		if (!warned) {
			warned = true;
			console.warn(`[ahp-surface-coverage] failed to write protocol surface observations to ${resolveOutputPath()}: ${error}`);
		}
	}
}
