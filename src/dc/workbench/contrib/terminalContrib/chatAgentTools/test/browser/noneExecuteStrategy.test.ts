/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { NullLogService } from '../../../../../../platform/log/common/log.js';
import type { ITerminalLogService } from '../../../../../../platform/terminal/common/terminal.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { runWithFakedTimers } from '../../../../../../base/test/common/timeTravelScheduler.js';
import { NoneExecuteStrategy } from '../../browser/executeStrategy/noneExecuteStrategy.js';
import type { ITerminalInstance } from '../../../../terminal/browser/terminal.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';

suite('NoneExecuteStrategy', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createLogService(): ITerminalLogService {
		return new class extends NullLogService { readonly _logBrand = undefined; };
	}

	function createMockTerminalAndXterm(contentsAsText: string, cursorLineText: string): {
		instance: ITerminalInstance;
		onDataEmitter: Emitter<string>;
	} {
		const onDataEmitter = store.add(new Emitter<string>());
		const activeBuffer = {};
		const alternateBuffer = {};

		const mockXterm = {
			raw: {
				registerMarker: () => ({
					line: 0,
					isDisposed: false,
					onDispose: Event.None,
					dispose: () => { },
				}),
				buffer: {
					active: {
						...activeBuffer,
						baseY: 0,
						cursorY: 1,
						getLine: () => ({
							translateToString: () => cursorLineText,
						}),
					},
					alternate: alternateBuffer,
					onBufferChange: () => ({ dispose: () => { } }),
				},
				onWriteParsed: Event.None,
			},
			getContentsAsText: () => contentsAsText,
		};

		const mockInstance = {
			xtermReadyPromise: Promise.resolve(mockXterm),
			onData: onDataEmitter.event,
			sendText: () => { },
		} as unknown as ITerminalInstance;

		return { instance: mockInstance, onDataEmitter };
	}

	test('should report "Command produced no output" when output is empty', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { instance } = createMockTerminalAndXterm(
			'   \n   \n   ',
			'user@host:~$ '
		);

		const logService = createLogService();
		const configService = new TestConfigurationService();
		const strategy = store.add(new NoneExecuteStrategy(instance, () => false, configService, logService));
		const cts = store.add(new CancellationTokenSource());

		const result = await strategy.execute('echo test', cts.token);

		assert.strictEqual(result.additionalInformation, 'Command produced no output');
	}));

	test('should not leak sandbox command echo as output when command produces no output', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const promptLine = '[ user@host:~/src (main) ] $ ';
		const sandboxCommandEcho = 'ELECTRON_RUN_AS_NODE=1 PATH="$PATH:/app/node_modules/@vscode/ripgrep/bin" '
			+ 'TMPDIR="/var/folders/bb/_8jjjyy971x2frm3nr3g7m4r0000gn/T" '
			+ '"/app/Contents/MacOS/Code - Insiders" "/app/Contents/Resources/app/node_modules/@vscode/sandbox-runtime/dist/cli.js" '
			+ '--settings "/var/folders/bb/_8jjjyy971x2frm3nr3g7m4r0000gn/T/vscode-sandbox-settings.json" '
			+ '-c \' git diff 0e5d5949d13f..2c357a926df6 -- \'\\\'\'src/foo.ts\'\\\'\' | grep -A3 -B3 \'\\\'\'someFunc\'\\\'\'\'';
		const terminalContent = `${promptLine}${sandboxCommandEcho}\n${' '.repeat(80)}\n${promptLine}`;

		const { instance } = createMockTerminalAndXterm(
			terminalContent,
			promptLine
		);

		const logService = createLogService();
		const configService = new TestConfigurationService();
		const strategy = store.add(new NoneExecuteStrategy(instance, () => false, configService, logService));
		const cts = store.add(new CancellationTokenSource());

		const result = await strategy.execute(
			'git diff 0e5d5949d13f..2c357a926df6 -- \'src/foo.ts\' | grep -A3 -B3 \'someFunc\'',
			cts.token
		);

		assert.strictEqual(result.output?.includes('sandbox-runtime') ?? false, false, 'Output should not leak sandbox-runtime path');
		assert.strictEqual(result.output?.includes('ELECTRON_RUN_AS_NODE') ?? false, false, 'Output should not leak ELECTRON_RUN_AS_NODE');

		assert.strictEqual(result.additionalInformation, 'Command produced no output');
	}));
});
