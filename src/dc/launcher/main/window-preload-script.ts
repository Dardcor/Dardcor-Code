import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRELOAD_LINES: string[] = [
	"'use strict';",
	'const { contextBridge, ipcRenderer } = require(\'electron\');',
	'const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);',
	'const send = (channel, ...args) => ipcRenderer.send(channel, ...args);',
	'const dcAPI = {',
	'  platform: process.platform,',
	'  arch: process.arch,',
	'  versions: {',
	'    node: process.versions.node,',
	'    electron: process.versions.electron,',
	'    chrome: process.versions.chrome,',
	'    v8: process.versions.v8',
	'  },',
	'  getPath: () => invoke(\'app:getPath\'),',
	'  getVersion: () => invoke(\'app:getVersion\'),',
	'  getPlatform: () => invoke(\'app:getPlatform\'),',
	'  getArch: () => invoke(\'app:getArch\'),',
	'  getLocale: () => invoke(\'app:getLocale\'),',
	'  getSystemTheme: () => invoke(\'app:getSystemTheme\'),',
	'  quit: () => invoke(\'app:quit\'),',
	'  relaunch: () => invoke(\'app:relaunch\'),',
	'  fs: {',
	'    readFile: (p) => invoke(\'fs:readFile\', p),',
	'    writeFile: (p, c) => invoke(\'fs:writeFile\', p, c),',
	'    readFileBinary: (p) => invoke(\'fs:readFileBinary\', p),',
	'    readDir: (p) => invoke(\'fs:readDir\', p),',
	'    stat: (p) => invoke(\'fs:stat\', p),',
	'    mkdir: (p, r) => invoke(\'fs:mkdir\', p, r),',
	'    delete: (p, r) => invoke(\'fs:delete\', p, r),',
	'    rename: (a, b) => invoke(\'fs:rename\', a, b),',
	'    watch: (p, r) => invoke(\'fs:watch\', p, r),',
	'    unwatch: (id) => invoke(\'fs:unwatch\', id),',
	'    onWatchEvent: (cb) => ipcRenderer.on(\'fs:watchEvent\', (_e, d) => cb(d))',
	'  },',
	'  dialogs: {',
	'    openFolder: (o) => invoke(\'dialog:openFolder\', o),',
	'    openFile: (o) => invoke(\'dialog:openFile\', o),',
	'    saveFile: (o) => invoke(\'dialog:saveFile\', o),',
	'    showMessage: (o) => invoke(\'dialog:showMessage\', o),',
	'    showError: (t, c) => invoke(\'dialog:showError\', t, c),',
	'    showWarning: (o) => invoke(\'dialog:showWarning\', o)',
	'  },',
	'  window: {',
	'    minimize: () => send(\'window:minimize\'),',
	'    maximize: () => send(\'window:maximize\'),',
	'    unmaximize: () => send(\'window:unmaximize\'),',
	'    close: () => send(\'window:close\'),',
	'    fullscreen: () => send(\'window:fullscreen\'),',
	'    isMaximized: () => invoke(\'window:isMaximized\'),',
	'    setTitle: (t) => send(\'window:setTitle\', t),',
	'    setSize: (w, h) => send(\'window:setSize\', w, h),',
	'    getBounds: () => invoke(\'window:getBounds\')',
	'  },',
	'  terminal: {',
	'    create: (cwd) => invoke(\'terminal:create\', cwd),',
	'    write: (id, data) => send(\'terminal:write\', { id, data }),',
	'    resize: (id, cols, rows) => invoke(\'terminal:resize\', { id, cols, rows }),',
	'    kill: (id) => invoke(\'terminal:kill\', id),',
	'    onData: (cb) => ipcRenderer.on(\'terminal:data\', (_e, d) => cb(d)),',
	'    onExit: (cb) => ipcRenderer.on(\'terminal:exit\', (_e, d) => cb(d))',
	'  },',
	'  storage: {',
	'    get: (key) => invoke(\'storage:get\', key),',
	'    set: (key, value) => invoke(\'storage:set\', key, value),',
	'    delete: (key) => invoke(\'storage:delete\', key),',
	'    all: () => invoke(\'storage:all\')',
	'  },',
	'  updates: {',
	'    check: () => invoke(\'update:check\'),',
	'    download: () => invoke(\'update:download\'),',
	'    install: () => invoke(\'update:install\'),',
	'    getState: () => invoke(\'update:getState\')',
	'  },',
	'  rpc: (channel, args) => invoke(\'dc:rpc\', channel, args)',
	'};',
	'if (contextBridge && contextBridge.exposeInMainWorld) {',
	'  contextBridge.exposeInMainWorld(\'dcAPI\', dcAPI);',
	'}',
	'if (typeof window !== \'undefined\') {',
	'  window.dcAPI = window.dcAPI || dcAPI;',
	'}'
];

export function buildPreloadScript(): string {
	return PRELOAD_LINES.join('\n');
}

export function buildPreloadScriptWithRuntime(extraLines: string[]): string {
	return [...PRELOAD_LINES, ...extraLines].join('\n');
}

export function getPreloadScriptPath(): string {
	return path.resolve(__dirname, '..', 'preload', 'preload.js');
}

export function writePreloadScript(): string {
	const scriptPath = getPreloadScriptPath();
	fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
	fs.writeFileSync(scriptPath, buildPreloadScript(), 'utf-8');
	return scriptPath;
}

export function getPreloadPathForWindow(): string | null {
	try {
		const scriptPath = writePreloadScript();
		return scriptPath;
	} catch {
		return null;
	}
}

export function buildPreloadDevScript(): string {
	return [
		...PRELOAD_LINES,
		'window.__DC_DEV__ = true;',
		'window.__DC_BUILD__ = \'dev\';'
	].join('\n');
}

export function getPreloadScriptLength(): number {
	return buildPreloadScript().length;
}
