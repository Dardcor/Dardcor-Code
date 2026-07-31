export interface UtilitySandboxConfig {
	env: Record<string, string>;
	execArgv: string[];
	flags: string[];
}

export function buildUtilitySandboxFlags(): string[] {
	return [
		'--disable-gpu',
		'--disable-software-rasterizer',
		'--disable-dev-shm-usage',
		'--no-zygote',
		'--disable-accelerated-2d-canvas'
	];
}

export function buildUtilityEnv(extra: Record<string, string> = {}): Record<string, string> {
	return {
		UTILITY_SANDBOX: '1',
		NODE_OPTIONS: '--disable-proto=throw',
		DC_UTILITY_PROCESS: '1',
		...extra
	};
}

export function buildUtilityExecArgv(extra: string[] = []): string[] {
	return [
		'--max-old-space-size=256',
		'--no-warnings',
		'--experimental-permission',
		'--allow-fs-read=*',
		'--allow-fs-write=*',
		...extra
	];
}

export function buildUtilitySandboxConfig(extra?: { env?: Record<string, string>; execArgv?: string[] }): UtilitySandboxConfig {
	return {
		env: buildUtilityEnv(extra?.env),
		execArgv: buildUtilityExecArgv(extra?.execArgv),
		flags: buildUtilitySandboxFlags()
	};
}

export function buildSandboxedPreloadScript(): string {
	return [
		"'use strict';",
		'const denied = new Set([\'child_process\', \'worker_threads\', \'fs\', \'net\', \'dns\', \'tls\', \'http\', \'https\', \'os\', \'path\', \'vm\']);',
		'const originalRequire = globalThis.require;',
		'if (typeof originalRequire === \'function\') {',
		'  globalThis.require = function (name) {',
		'    if (denied.has(name)) {',
		'      throw new Error(\'Access to module \' + name + \' is denied in utility sandbox\');',
		'    }',
		'    return originalRequire(name);',
		'  };',
		'  globalThis.require.cache = originalRequire.cache;',
		'  globalThis.require.resolve = originalRequire.resolve;',
		'}',
		'if (typeof process !== \'undefined\') {',
		'  process.allowUncaughtException = false;',
		'  process.removeAllListeners = function () { return process; };',
		'}',
		'globalThis.__DC_SANDBOXED__ = true;'
	].join('\n');
}

export function isSandboxedUtility(): boolean {
	return process.env.UTILITY_SANDBOX === '1';
}

export function denyNodeIntegrationPreload(): string {
	return buildSandboxedPreloadScript();
}

export function getSandboxStatus(): { sandboxed: boolean; flags: string[]; envKeys: string[] } {
	return {
		sandboxed: isSandboxedUtility(),
		flags: buildUtilitySandboxFlags(),
		envKeys: Object.keys(buildUtilityEnv())
	};
}
