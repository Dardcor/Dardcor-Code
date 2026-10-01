import * as fs from 'fs';
import * as path from 'node:path';
import * as os from 'node:os';

function copyDirectoryContentsRecursive(src: string, dest: string): void {
	if (!fs.existsSync(src)) {
		return;
	}
	if (!fs.existsSync(dest)) {
		fs.mkdirSync(dest, { recursive: true });
	}
	const entries = fs.readdirSync(src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDirectoryContentsRecursive(srcPath, destPath);
		} else if (!fs.existsSync(destPath)) {
			try {
				fs.copyFileSync(srcPath, destPath);
			} catch {}
		}
	}
}

export function migrateLegacyUserData(targetUserDataPath: string): void {
	try {
		const appData = process.env['APPDATA'] || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : (process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config')));
		const legacyUserDataPath = path.join(appData, 'code-oss-dev');
		if (fs.existsSync(legacyUserDataPath) && legacyUserDataPath.toLowerCase() !== targetUserDataPath.toLowerCase()) {
			const legacyUser = path.join(legacyUserDataPath, 'User');
			const targetUser = path.join(targetUserDataPath, 'User');
			if (fs.existsSync(legacyUser)) {
				if (!fs.existsSync(targetUser)) {
					fs.mkdirSync(targetUser, { recursive: true });
				}

				const legacyAgentSessions = path.join(legacyUser, 'agent-sessions.code-workspace');
				const targetAgentSessions = path.join(targetUser, 'agent-sessions.code-workspace');
				if (fs.existsSync(legacyAgentSessions) && !fs.existsSync(targetAgentSessions)) {
					try {
						fs.copyFileSync(legacyAgentSessions, targetAgentSessions);
					} catch {}
				}

				const legacyBuiltinAgents = path.join(legacyUser, 'profiles', 'builtin', 'agents');
				const targetBuiltinAgents = path.join(targetUser, 'profiles', 'builtin', 'agents');
				if (fs.existsSync(legacyBuiltinAgents)) {
					copyDirectoryContentsRecursive(legacyBuiltinAgents, targetBuiltinAgents);
				}

				const legacyWorkspaceStorage = path.join(legacyUser, 'workspaceStorage');
				const targetWorkspaceStorage = path.join(targetUser, 'workspaceStorage');
				if (fs.existsSync(legacyWorkspaceStorage)) {
					if (!fs.existsSync(targetWorkspaceStorage)) {
						fs.mkdirSync(targetWorkspaceStorage, { recursive: true });
					}
					const wsEntries = fs.readdirSync(legacyWorkspaceStorage, { withFileTypes: true });
					for (const wsEntry of wsEntries) {
						if (!wsEntry.isDirectory()) {
							continue;
						}
						const srcWs = path.join(legacyWorkspaceStorage, wsEntry.name);
						const dstWs = path.join(targetWorkspaceStorage, wsEntry.name);
						if (!fs.existsSync(dstWs)) {
							try {
								fs.cpSync(srcWs, dstWs, { recursive: true });
							} catch {
								copyDirectoryContentsRecursive(srcWs, dstWs);
							}
						} else {
							for (const sub of ['chatSessions', 'chatEditingSessions', 'emptyWindowChatSessions']) {
								const srcSub = path.join(srcWs, sub);
								const dstSub = path.join(dstWs, sub);
								if (fs.existsSync(srcSub)) {
									copyDirectoryContentsRecursive(srcSub, dstSub);
								}
							}
							const srcDb = path.join(srcWs, 'state.vscdb');
							const dstDb = path.join(dstWs, 'state.vscdb');
							if (fs.existsSync(srcDb) && !fs.existsSync(dstDb)) {
								try {
									fs.copyFileSync(srcDb, dstDb);
								} catch {}
							}
						}
					}

					const targetWsDirs = fs.readdirSync(targetWorkspaceStorage, { withFileTypes: true });
					for (const targetWsDir of targetWsDirs) {
						if (!targetWsDir.isDirectory()) {
							continue;
						}
						const wsJsonPath = path.join(targetWorkspaceStorage, targetWsDir.name, 'workspace.json');
						if (fs.existsSync(wsJsonPath)) {
							try {
								const content = fs.readFileSync(wsJsonPath, 'utf8');
								if (content.includes('agent-sessions.code-workspace')) {
									const targetChatSessions = path.join(targetWorkspaceStorage, targetWsDir.name, 'chatSessions');
									for (const wsEntry of wsEntries) {
										const legacyWsJson = path.join(legacyWorkspaceStorage, wsEntry.name, 'workspace.json');
										if (fs.existsSync(legacyWsJson)) {
											const legacyContent = fs.readFileSync(legacyWsJson, 'utf8');
											if (legacyContent.includes('agent-sessions.code-workspace')) {
												const legacyChatSessions = path.join(legacyWorkspaceStorage, wsEntry.name, 'chatSessions');
												if (fs.existsSync(legacyChatSessions)) {
													copyDirectoryContentsRecursive(legacyChatSessions, targetChatSessions);
												}
											}
										}
									}
								}
							} catch {}
						}
					}
				}

				const legacyGlobalStorage = path.join(legacyUser, 'globalStorage');
				const targetGlobalStorage = path.join(targetUser, 'globalStorage');
				if (fs.existsSync(legacyGlobalStorage)) {
					copyDirectoryContentsRecursive(legacyGlobalStorage, targetGlobalStorage);
				}
			}
		}

		const legacyHomeFolder = path.join(os.homedir(), '.dardcor-code-dev');
		const targetHomeFolder = path.join(os.homedir(), '.dardcor-code');
		if (fs.existsSync(legacyHomeFolder)) {
			copyDirectoryContentsRecursive(legacyHomeFolder, targetHomeFolder);
		}
	} catch {}
}
