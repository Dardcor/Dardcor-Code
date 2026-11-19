/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, doesNotThrow, equal, ok, strictEqual, throws } from 'assert';
import { commands, ConfigurationTarget, Disposable, env, EnvironmentVariableMutator, EnvironmentVariableMutatorOptions, EnvironmentVariableMutatorType, EventEmitter, ExtensionContext, extensions, ExtensionTerminalOptions, Pseudoterminal, Terminal, TerminalDimensions, TerminalExitReason, TerminalOptions, TerminalState, UIKind, Uri, window, workspace } from 'vscode';
import { assertNoRpc, poll } from '../utils';

(env.uiKind === UIKind.Web ? suite.skip : suite)('vscode API - terminal', () => {
	let extensionContext: ExtensionContext;

	suiteSetup(async () => {
		await extensions.getExtension('vscode.vscode-api-tests')?.activate();
		extensionContext = global.testExtensionContext;

		const config = workspace.getConfiguration('terminal.integrated');
		await config.update('showExitAlert', false, ConfigurationTarget.Global);
		await config.update('gpuAcceleration', 'off', ConfigurationTarget.Global);
		await config.update('environmentChangesRelaunch', false, ConfigurationTarget.Global);
		await config.update('localEchoEnabled', 'off', ConfigurationTarget.Global);
		await config.update('shellIntegration.enabled', false);
	});

	suite('Terminal', () => {
		const disposables: Disposable[] = [];

		teardown(async () => {
			assertNoRpc();
			disposables.forEach(d => d.dispose());
			disposables.length = 0;
			const config = workspace.getConfiguration('terminal.integrated');
			await config.update('shellIntegration.enabled', undefined);
		});

		test('sendText immediately after createTerminal should not throw', async () => {
			const terminal = window.createTerminal();
			const result = await new Promise<Terminal>(r => {
				disposables.push(window.onDidOpenTerminal(t => {
					if (t === terminal) {
						r(t);
					}
				}));
			});
			equal(result, terminal);
			doesNotThrow(terminal.sendText.bind(terminal, 'echo "foo"'));
			await new Promise<void>(r => {
				disposables.push(window.onDidCloseTerminal(t => {
					if (t === terminal) {
						r();
					}
				}));
				terminal.dispose();
			});
		});

		test('echo works in the default shell', async () => {
			const terminal = await new Promise<Terminal>(r => {
				disposables.push(window.onDidOpenTerminal(t => {
					if (t === terminal) {
						r(terminal);
					}
				}));
				const terminal = window.createTerminal({
					env: { TEST: '`' }
				});
				terminal.show();
			});

			let data = '';
			await new Promise<void>(r => {
				disposables.push(window.onDidWriteTerminalData(e => {
					if (e.terminal === terminal) {
						data += e.data;
						if (data.indexOf('`') !== 0) {
							r();
						}
					}
				}));
				if (process.platform === 'win32') {
					terminal.sendText(`$env:TEST`);
				} else {
					terminal.sendText(`echo $TEST`);
				}
			});

			await new Promise<void>(r => {
				terminal.dispose();
				disposables.push(window.onDidCloseTerminal(t => {
					strictEqual(terminal, t);
					r();
				}));
			});
		});

		test('onDidCloseTerminal event fires when terminal is disposed', async () => {
			const terminal = window.createTerminal();
			const result = await new Promise<Terminal>(r => {
				disposables.push(window.onDidOpenTerminal(t => {
					if (t === terminal) {
						r(t);
					}
				}));
			});
			equal(result, terminal);
			await new Promise<void>(r => {
				disposables.push(window.onDidCloseTerminal(t => {
					if (t === terminal) {
						r();
					}
				}));
				terminal.dispose();
			});
		});

		test('processId immediately after createTerminal should fetch the pid', async () => {
			const terminal = window.createTerminal();
			const result = await new Promise<Terminal>(r => {
				disposables.push(window.onDidOpenTerminal(t => {
					if (t === terminal) {
						r(t);
					}
				}));
			});
			equal(result, terminal);
			const pid = await result.processId;
			equal(true, pid && pid > 0);
			await new Promise<void>(r => {
				disposables.push(window.onDidCloseTerminal(t => {
					if (t === terminal) {
						r();
					}
				}));
				terminal.dispose();
			});
		});

		test('name in constructor should set terminal.name', async () => {
			const terminal = window.createTerminal('a');
			const result = await new Promise<Terminal>(r => {
				disposables.push(window.onDidOpenTerminal(t => {
					if (t === terminal) {
						r(t);
					}
				}));
			});
			equal(result, terminal);
			await new Promise<void>(r => {
				disposables.push(window.onDidCloseTerminal(t => {
					if (t === terminal) {
						r();
					}
				}));
				terminal.dispose();
			});
		});

		test('creationOptions should be set and readonly for TerminalOptions terminals', async () => {
			const options = {
				name: 'foo',
				hideFromUser: true
			};
			const terminal = window.createTerminal(options);
			const terminalOptions = terminal.creationOptions as TerminalOptions;
			const result = await new Promise<Terminal>(r => {
				disposables.push(window.onDidOpenTerminal(t => {
					if (t === terminal) {
						r(t);
					}
				}));
			});
			equal(result, terminal);
			await new Promise<void>(r => {
				disposables.push(window.onDidCloseTerminal(t => {
					if (t === terminal) {
						r();
					}
				}));
				terminal.dispose();
			});
			throws(() => terminalOptions.name = 'bad', 'creationOptions should be readonly at runtime');
		});

		test('onDidOpenTerminal should fire when a terminal is created', async () => {
			const terminal = window.createTerminal('b');
			const result = await new Promise<Terminal>(r => {
				disposables.push(window.onDidOpenTerminal(t => {
					if (t === terminal) {
						r(t);
					}
				}));
			});
			equal(result, terminal);
			await new Promise<void>(r => {
				disposables.push(window.onDidCloseTerminal(t => {
					if (t === terminal) {
						r();
					}
				}));
				terminal.dispose();
			});
		});

		test('exitStatus.code should be set to undefined after a terminal is disposed', async () => {
			const terminal = window.createTerminal();
			const result = await new Promise<Terminal>(r => {
				disposables.push(window.onDidOpenTerminal(t => {
					if (t === terminal) {
						r(t);
					}
				}));
			});
			equal(result, terminal);
			await new Promise<void>(r => {
				disposables.push(window.onDidCloseTerminal(t => {
					if (t === terminal) {
						deepStrictEqual(t.exitStatus, { code: undefined, reason: TerminalExitReason.Extension });
						r();
					}
				}));
				terminal.dispose();
			});
		});

		test('onDidChangeTerminalState should fire with isInteractedWith after writing to a terminal', async () => {
			const terminal = window.createTerminal();
			strictEqual(terminal.state.isInteractedWith, false);
			const eventState = await new Promise<TerminalState>(r => {
				disposables.push(window.onDidChangeTerminalState(e => {
					if (e === terminal && e.state.isInteractedWith) {
						r(e.state);
					}
				}));
				terminal.sendText('test');
			});
			strictEqual(eventState.isInteractedWith, true);
			await new Promise<void>(r => {
				disposables.push(window.onDidCloseTerminal(t => {
					if (t === terminal) {
						r();
					}
				}));
				terminal.dispose();
			});
		});

		test('onDidChangeTerminalState should fire with shellType when created', async () => {
			const terminal = window.createTerminal();
			if (terminal.state.shell) {
				return;
			}
			await new Promise<void>(r => {
				disposables.push(window.onDidChangeTerminalState(e => {
					if (e === terminal && e.state.shell) {
						r();
					}
				}));
			});
			await new Promise<void>(r => {
				disposables.push(window.onDidCloseTerminal(t => {
					if (t === terminal) {
						r();
					}
				}));
				terminal.dispose();
			});
		});



		suite('hideFromUser', () => {
			test('should be available to terminals API', async () => {
				const terminal = window.createTerminal({ name: 'bg', hideFromUser: true });
				const result = await new Promise<Terminal>(r => {
					disposables.push(window.onDidOpenTerminal(t => {
						if (t === terminal) {
							r(t);
						}
					}));
				});
				equal(result, terminal);
				equal(true, window.terminals.indexOf(terminal) !== -1);
				await new Promise<void>(r => {
					disposables.push(window.onDidCloseTerminal(t => {
						if (t === terminal) {
							r();
						}
					}));
					terminal.dispose();
				});
			});
		});

		suite('selection', () => {
			test('should be undefined immediately after creation', async () => {
				const terminal = window.createTerminal({ name: 'selection test' });
				terminal.show();
				equal(terminal.selection, undefined);
				terminal.dispose();
			});
			test('should be defined after selecting all content', async () => {
				const terminal = window.createTerminal({ name: 'selection test' });
				terminal.show();
				await new Promise<void>(r => {
					const disposable = window.onDidWriteTerminalData(() => {
						disposable.dispose();
						r();
					});
				});
				await commands.executeCommand('workbench.action.terminal.selectAll');
				await poll<void>(() => Promise.resolve(), () => terminal.selection !== undefined, 'selection should be defined');
				terminal.dispose();
			});
			test('should be undefined after clearing a selection', async () => {
				const terminal = window.createTerminal({ name: 'selection test' });
				terminal.show();
				await new Promise<void>(r => {
					const disposable = window.onDidWriteTerminalData(() => {
						disposable.dispose();
						r();
					});
				});
				await commands.executeCommand('workbench.action.terminal.selectAll');
				await poll<void>(() => Promise.resolve(), () => terminal.selection !== undefined, 'selection should be defined');
				await commands.executeCommand('workbench.action.terminal.clearSelection');
				await poll<void>(() => Promise.resolve(), () => terminal.selection === undefined, 'selection should not be defined');
				terminal.dispose();
			});
		});

		suite('window.onDidWriteTerminalData', () => {
			test.skip('should listen to all future terminal data events', function (done) {
				this.retries(3);

				const openEvents: string[] = [];
				const dataEvents: { name: string; data: string }[] = [];
				const closeEvents: string[] = [];
				disposables.push(window.onDidOpenTerminal(e => openEvents.push(e.name)));

				let resolveOnceDataWritten: (() => void) | undefined;
				let resolveOnceClosed: (() => void) | undefined;

				disposables.push(window.onDidWriteTerminalData(e => {
					dataEvents.push({ name: e.terminal.name, data: e.data });

					resolveOnceDataWritten!();
				}));

				disposables.push(window.onDidCloseTerminal(e => {
					closeEvents.push(e.name);
					try {
						if (closeEvents.length === 1) {
							deepStrictEqual(openEvents, ['test1']);
							ok(dataEvents.some(e => e.name === 'test1' && e.data === 'write1'));
							deepStrictEqual(closeEvents, ['test1']);
						} else if (closeEvents.length === 2) {
							deepStrictEqual(openEvents, ['test1', 'test2']);
							ok(dataEvents.some(e => e.name === 'test1' && e.data === 'write1'));
							ok(dataEvents.some(e => e.name === 'test2' && e.data === 'write2'));
							deepStrictEqual(closeEvents, ['test1', 'test2']);
						}
						resolveOnceClosed!();
					} catch (e) {
						done(e);
					}
				}));

				const term1Write = new EventEmitter<string>();
				const term1Close = new EventEmitter<void>();
				window.createTerminal({
					name: 'test1', pty: {
						onDidWrite: term1Write.event,
						onDidClose: term1Close.event,
						open: async () => {
							term1Write.fire('write1');

							await new Promise<void>(resolve => { resolveOnceDataWritten = resolve; });

							term1Close.fire();

							await new Promise<void>(resolve => { resolveOnceClosed = resolve; });

							const term2Write = new EventEmitter<string>();
							const term2Close = new EventEmitter<void>();
							window.createTerminal({
								name: 'test2', pty: {
									onDidWrite: term2Write.event,
									onDidClose: term2Close.event,
									open: async () => {
										term2Write.fire('write2');

										await new Promise<void>(resolve => { resolveOnceDataWritten = resolve; });

										term2Close.fire();

										await new Promise<void>(resolve => { resolveOnceClosed = resolve; });

										done();
									},
									close: () => { }
								}
							});
						},
						close: () => { }
					}
				});
			});
		});

		suite('Extension pty terminals', () => {
			test('should fire onDidOpenTerminal and onDidCloseTerminal', async () => {
				const pty: Pseudoterminal = {
					onDidWrite: new EventEmitter<string>().event,
					open: () => { },
					close: () => { }
				};
				const terminal = await new Promise<Terminal>(r => {
					disposables.push(window.onDidOpenTerminal(t => {
						if (t.name === 'c') {
							r(t);
						}
					}));
					window.createTerminal({ name: 'c', pty });
				});
				await new Promise<void>(r => {
					disposables.push(window.onDidCloseTerminal(() => r()));
					terminal.dispose();
				});
			});



			test.skip('should respect dimension overrides', async () => {
				const writeEmitter = new EventEmitter<string>();
				const overrideDimensionsEmitter = new EventEmitter<TerminalDimensions>();
				const pty: Pseudoterminal = {
					onDidWrite: writeEmitter.event,
					onDidOverrideDimensions: overrideDimensionsEmitter.event,
					open: () => overrideDimensionsEmitter.fire({ columns: 10, rows: 5 }),
					close: () => { }
				};
				const terminal = await new Promise<Terminal>(r => {
					disposables.push(window.onDidOpenTerminal(t => {
						if (t === created) {
							r(t);
						}
					}));
					const created = window.createTerminal({ name: 'foo', pty });
				});
				if (terminal.dimensions?.columns === 10 && terminal.dimensions?.rows === 5) {
					return;
				}
				await new Promise<void>(r => {
					disposables.push(window.onDidChangeTerminalDimensions(e => {
						console.log(`window.onDidChangeTerminalDimensions event, dimensions = ${e.dimensions?.columns}x${e.dimensions?.rows}`);
						if (e.terminal === terminal && e.dimensions.columns === 10 && e.dimensions.rows === 5) {
							disposables.push(window.onDidCloseTerminal(() => r()));
							terminal.dispose();
						}
					}));
					console.log(`listening for window.onDidChangeTerminalDimensions, current dimensions = ${terminal.dimensions?.columns}x${terminal.dimensions?.rows}`);
					terminal.show();
				});
			});

			test('should change terminal name', async () => {
				const changeNameEmitter = new EventEmitter<string>();
				const closeEmitter = new EventEmitter<number | undefined>();
				const pty: Pseudoterminal = {
					onDidWrite: new EventEmitter<string>().event,
					onDidChangeName: changeNameEmitter.event,
					onDidClose: closeEmitter.event,
					open: () => {
						changeNameEmitter.fire('bar');
						closeEmitter.fire(undefined);
					},
					close: () => { }
				};
				await new Promise<void>(r => {
					disposables.push(window.onDidOpenTerminal(t1 => {
						if (t1 === created) {
							disposables.push(window.onDidCloseTerminal(t2 => {
								if (t2 === created) {
									strictEqual(t1.name, 'bar');
									r();
								}
							}));
						}
					}));
					const created = window.createTerminal({ name: 'foo', pty });
				});
			});

			test('exitStatus.code should be set to the exit code (undefined)', async () => {
				const writeEmitter = new EventEmitter<string>();
				const closeEmitter = new EventEmitter<number | undefined>();
				const pty: Pseudoterminal = {
					onDidWrite: writeEmitter.event,
					onDidClose: closeEmitter.event,
					open: () => closeEmitter.fire(undefined),
					close: () => { }
				};
				await new Promise<void>(r => {
					disposables.push(window.onDidOpenTerminal(t1 => {
						if (t1 === created) {
							strictEqual(created.exitStatus, undefined);
							disposables.push(window.onDidCloseTerminal(t2 => {
								if (t2 === created) {
									deepStrictEqual(created.exitStatus, { code: undefined, reason: TerminalExitReason.Process });
									r();
								}
							}));
						}
					}));
					const created = window.createTerminal({ name: 'foo', pty });
				});
			});

			test('exitStatus.code should be set to the exit code (zero)', async () => {
				const writeEmitter = new EventEmitter<string>();
				const closeEmitter = new EventEmitter<number | undefined>();
				const pty: Pseudoterminal = {
					onDidWrite: writeEmitter.event,
					onDidClose: closeEmitter.event,
					open: () => closeEmitter.fire(0),
					close: () => { }
				};
				await new Promise<void>(r => {
					disposables.push(window.onDidOpenTerminal(t1 => {
						if (t1 === created) {
							strictEqual(created.exitStatus, undefined);
							disposables.push(window.onDidCloseTerminal(t2 => {
								if (t2 === created) {
									deepStrictEqual(created.exitStatus, { code: 0, reason: TerminalExitReason.Process });
									r();
								}
							}));
						}
					}));
					const created = window.createTerminal({ name: 'foo', pty });
				});
			});

			test('exitStatus.code should be set to the exit code (non-zero)', async () => {
				const writeEmitter = new EventEmitter<string>();
				const closeEmitter = new EventEmitter<number | undefined>();
				const pty: Pseudoterminal = {
					onDidWrite: writeEmitter.event,
					onDidClose: closeEmitter.event,
					open: () => {
						setTimeout(() => closeEmitter.fire(22), 500);
					},
					close: () => { }
				};
				await new Promise<void>(r => {
					disposables.push(window.onDidOpenTerminal(t1 => {
						if (t1 === created) {
							strictEqual(created.exitStatus, undefined);
							disposables.push(window.onDidCloseTerminal(t2 => {
								if (t2 === created) {
									deepStrictEqual(created.exitStatus, { code: 22, reason: TerminalExitReason.Process });
									r();
								}
							}));
						}
					}));
					const created = window.createTerminal({ name: 'foo', pty });
				});
			});

			test('creationOptions should be set and readonly for ExtensionTerminalOptions terminals', async () => {
				const writeEmitter = new EventEmitter<string>();
				const pty: Pseudoterminal = {
					onDidWrite: writeEmitter.event,
					open: () => { },
					close: () => { }
				};
				const options = { name: 'foo', pty };
				await new Promise<void>(r => {
					disposables.push(window.onDidOpenTerminal(term => {
						if (term === terminal) {
							terminal.dispose();
							disposables.push(window.onDidCloseTerminal(() => r()));
						}
					}));
					const terminal = window.createTerminal(options);
					strictEqual(terminal.name, 'foo');
					const terminalOptions = terminal.creationOptions as ExtensionTerminalOptions;
					strictEqual(terminalOptions.name, 'foo');
					strictEqual(terminalOptions.pty, pty);
					throws(() => terminalOptions.name = 'bad', 'creationOptions should be readonly at runtime');
				});
			});
		});

		(process.platform === 'win32' ? suite.skip : suite)('environmentVariableCollection', () => {
			test('should have collection variables apply to terminals immediately after setting', async () => {
				const collection = extensionContext.environmentVariableCollection;
				disposables.push({ dispose: () => collection.clear() });
				collection.replace('A', '~a2~');
				collection.append('B', '~b2~');
				collection.prepend('C', '~c2~');
				const terminal = window.createTerminal({
					env: {
						A: 'a1',
						B: 'b1',
						C: 'c1'
					}
				});

				let data = '';
				disposables.push(window.onDidWriteTerminalData(e => {
					if (terminal !== e.terminal) {
						return;
					}
					data += sanitizeData(e.data);
				}));

				terminal.sendText('echo "$A $B $C"');

				try {
					await poll<void>(() => Promise.resolve(), () => data.includes('~a2~'), '~a2~ should be printed');
					await poll<void>(() => Promise.resolve(), () => data.includes('b1~b2~'), 'b1~b2~ should be printed');
					await poll<void>(() => Promise.resolve(), () => data.includes('~c2~c1'), '~c2~c1 should be printed');
				} catch (err) {
					console.error('DATA UP UNTIL NOW:', data);
					throw err;
				}

				await new Promise<void>(r => {
					disposables.push(window.onDidCloseTerminal(() => r()));
					terminal.dispose();
				});
			});

			test('should have collection variables apply to environment variables that don\'t exist', async () => {
				const collection = extensionContext.environmentVariableCollection;
				disposables.push({ dispose: () => collection.clear() });
				collection.replace('A', '~a2~');
				collection.append('B', '~b2~');
				collection.prepend('C', '~c2~');
				const terminal = window.createTerminal({
					env: {
						A: null,
						B: null,
						C: null
					}
				});

				let data = '';
				disposables.push(window.onDidWriteTerminalData(e => {
					if (terminal !== e.terminal) {
						return;
					}
					data += sanitizeData(e.data);
				}));

				terminal.sendText('echo "$A $B $C"');

				try {
					await poll<void>(() => Promise.resolve(), () => data.includes('~a2~'), '~a2~ should be printed');
					await poll<void>(() => Promise.resolve(), () => data.includes('~b2~'), '~b2~ should be printed');
					await poll<void>(() => Promise.resolve(), () => data.includes('~c2~'), '~c2~ should be printed');
				} catch (err) {
					console.error('DATA UP UNTIL NOW:', data);
					throw err;
				}

				await new Promise<void>(r => {
					disposables.push(window.onDidCloseTerminal(() => r()));
					terminal.dispose();
				});
			});

			test('should respect clearing entries', async () => {
				const collection = extensionContext.environmentVariableCollection;
				disposables.push({ dispose: () => collection.clear() });
				collection.replace('A', '~a2~');
				collection.replace('B', '~a2~');
				collection.clear();
				const terminal = window.createTerminal({
					env: {
						A: '~a1~',
						B: '~b1~'
					}
				});

				let data = '';
				disposables.push(window.onDidWriteTerminalData(e => {
					if (terminal !== e.terminal) {
						return;
					}
					data += sanitizeData(e.data);
				}));

				terminal.sendText('echo "$A $B"');

				try {
					await poll<void>(() => Promise.resolve(), () => data.includes('~a1~'), '~a1~ should be printed');
					await poll<void>(() => Promise.resolve(), () => data.includes('~b1~'), '~b1~ should be printed');
				} catch (err) {
					console.error('DATA UP UNTIL NOW:', data);
					throw err;
				}

				await new Promise<void>(r => {
					disposables.push(window.onDidCloseTerminal(() => r()));
					terminal.dispose();
				});
			});

			test('should respect deleting entries', async () => {
				const collection = extensionContext.environmentVariableCollection;
				disposables.push({ dispose: () => collection.clear() });
				collection.replace('A', '~a2~');
				collection.replace('B', '~b2~');
				collection.delete('A');
				const terminal = window.createTerminal({
					env: {
						A: '~a1~',
						B: '~b2~'
					}
				});

				let data = '';
				disposables.push(window.onDidWriteTerminalData(e => {
					if (terminal !== e.terminal) {
						return;
					}
					data += sanitizeData(e.data);
				}));

				terminal.sendText('echo "$A $B"');

				try {
					await poll<void>(() => Promise.resolve(), () => data.includes('~a1~'), '~a1~ should be printed');
					await poll<void>(() => Promise.resolve(), () => data.includes('~b2~'), '~b2~ should be printed');
				} catch (err) {
					console.error('DATA UP UNTIL NOW:', data);
					throw err;
				}

				await new Promise<void>(r => {
					disposables.push(window.onDidCloseTerminal(() => r()));
					terminal.dispose();
				});
			});

			test('get and forEach should work', () => {
				const collection = extensionContext.environmentVariableCollection;
				disposables.push({ dispose: () => collection.clear() });
				collection.replace('A', '~a2~');
				collection.append('B', '~b2~');
				collection.prepend('C', '~c2~');
				const defaultOptions: Required<EnvironmentVariableMutatorOptions> = {
					applyAtProcessCreation: true,
					applyAtShellIntegration: false
				};
				deepStrictEqual(collection.get('A'), { value: '~a2~', type: EnvironmentVariableMutatorType.Replace, options: defaultOptions, variable: 'A' });
				deepStrictEqual(collection.get('B'), { value: '~b2~', type: EnvironmentVariableMutatorType.Append, options: defaultOptions, variable: 'B' });
				deepStrictEqual(collection.get('C'), { value: '~c2~', type: EnvironmentVariableMutatorType.Prepend, options: defaultOptions, variable: 'C' });
				const entries: [string, EnvironmentVariableMutator][] = [];
				collection.forEach((v, m) => entries.push([v, m]));
				deepStrictEqual(entries, [
					['A', { value: '~a2~', type: EnvironmentVariableMutatorType.Replace, options: defaultOptions, variable: 'A' }],
					['B', { value: '~b2~', type: EnvironmentVariableMutatorType.Append, options: defaultOptions, variable: 'B' }],
					['C', { value: '~c2~', type: EnvironmentVariableMutatorType.Prepend, options: defaultOptions, variable: 'C' }]
				]);
			});

			test('get and forEach should work (scope)', () => {
				const collection = extensionContext.environmentVariableCollection;
				disposables.push({ dispose: () => collection.clear() });
				const scope = { workspaceFolder: { uri: Uri.file('workspace1'), name: 'workspace1', index: 0 } };
				const scopedCollection = collection.getScoped(scope);
				scopedCollection.replace('A', 'scoped~a2~');
				scopedCollection.append('B', 'scoped~b2~');
				scopedCollection.prepend('C', 'scoped~c2~');
				collection.replace('A', '~a2~');
				collection.append('B', '~b2~');
				collection.prepend('C', '~c2~');
				const defaultOptions: Required<EnvironmentVariableMutatorOptions> = {
					applyAtProcessCreation: true,
					applyAtShellIntegration: false
				};
				const expectedScopedCollection = collection.getScoped(scope);
				deepStrictEqual(expectedScopedCollection.get('A'), { value: 'scoped~a2~', type: EnvironmentVariableMutatorType.Replace, options: defaultOptions, variable: 'A' });
				deepStrictEqual(expectedScopedCollection.get('B'), { value: 'scoped~b2~', type: EnvironmentVariableMutatorType.Append, options: defaultOptions, variable: 'B' });
				deepStrictEqual(expectedScopedCollection.get('C'), { value: 'scoped~c2~', type: EnvironmentVariableMutatorType.Prepend, options: defaultOptions, variable: 'C' });

				const entries: [string, EnvironmentVariableMutator][] = [];
				expectedScopedCollection.forEach((v, m) => entries.push([v, m]));
				deepStrictEqual(entries.map(v => v[1]), [
					{ value: 'scoped~a2~', type: EnvironmentVariableMutatorType.Replace, options: defaultOptions, variable: 'A' },
					{ value: 'scoped~b2~', type: EnvironmentVariableMutatorType.Append, options: defaultOptions, variable: 'B' },
					{ value: 'scoped~c2~', type: EnvironmentVariableMutatorType.Prepend, options: defaultOptions, variable: 'C' }
				]);
				deepStrictEqual(entries.map(v => v[0]), ['A', 'B', 'C']);
			});
		});
	});
});

function sanitizeData(data: string): string {
	data = data.replace(/[\r\n]/g, '');

	const CSI_SEQUENCE = /(:?(:?\x1b\[|\x9B)[=?>!]?[\d;:]*["$#'* ]?[a-zA-Z@^`{}|~])|(:?\x1b\].*?\x07)/g;
	data = data.replace(CSI_SEQUENCE, '');

	return data;
}
