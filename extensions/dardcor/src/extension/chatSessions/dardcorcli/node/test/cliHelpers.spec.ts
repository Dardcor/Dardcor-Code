/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { homedir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
	getCopilotCliStateDir,
	getCopilotCLISessionStateDir,
	getCopilotHome,
} from '../cliHelpers';

const originalCopilotHome = process.env.COPILOT_HOME;
const originalXdgStateHome = process.env.XDG_STATE_HOME;

function setEnv(
	name: 'COPILOT_HOME' | 'XDG_STATE_HOME',
	value: string | undefined,
): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

afterEach(() => {
	setEnv('COPILOT_HOME', originalCopilotHome);
	setEnv('XDG_STATE_HOME', originalXdgStateHome);
});

describe('Copilot CLI state directories', () => {
	it('uses COPILOT_HOME', () => {
		setEnv('COPILOT_HOME', '/tmp/dardcor-home');
		setEnv('XDG_STATE_HOME', '/tmp/xdg-state');

		expect(getCopilotHome()).toBe('/tmp/dardcor-home');
		expect(getCopilotCliStateDir()).toBe(join('/tmp/dardcor-home', 'ide'));
		expect(getCopilotCLISessionStateDir()).toBe(
			join('/tmp/dardcor-home', 'session-state'),
		);
	});

	it('does not use the legacy XDG_STATE_HOME location', () => {
		setEnv('COPILOT_HOME', undefined);
		setEnv('XDG_STATE_HOME', '/tmp/xdg-state');

		expect(getCopilotHome()).toBe(join(homedir(), '.dardcor'));
		expect(getCopilotCliStateDir()).toBe(
			join(homedir(), '.dardcor', 'ide'),
		);
		expect(getCopilotCLISessionStateDir()).toBe(
			join(homedir(), '.dardcor', 'session-state'),
		);
	});

	it('falls back to the user home directory', () => {
		setEnv('COPILOT_HOME', undefined);
		setEnv('XDG_STATE_HOME', undefined);

		expect(getCopilotHome()).toBe(join(homedir(), '.dardcor'));
		expect(getCopilotCliStateDir()).toBe(
			join(homedir(), '.dardcor', 'ide'),
		);
		expect(getCopilotCLISessionStateDir()).toBe(
			join(homedir(), '.dardcor', 'session-state'),
		);
	});
});
