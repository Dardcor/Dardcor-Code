/**
 * Dardcor Code - Template String Interpolator (Task 99)
 */

export function interpolate(template: string, vars: Record<string, string | number | boolean>): string {
	return template.replace(/\$\{([^}]+)\}/g, (match, key) => {
		const trimmed = key.trim();
		return trimmed in vars ? String(vars[trimmed]) : match;
	});
}

export function interpolateEnv(template: string, env: Record<string, string | undefined> = {}): string {
	return template.replace(/\$\{env:([^}]+)\}/g, (_match, key) => {
		return env[key.trim()] ?? '';
	});
}

export function interpolateConfig(template: string, configLookup: (key: string) => string | undefined): string {
	return template.replace(/\$\{config:([^}]+)\}/g, (_match, key) => {
		return configLookup(key.trim()) ?? '';
	});
}

export function resolveVariables(template: string, context: {
	vars?: Record<string, string>;
	env?: Record<string, string | undefined>;
	config?: (key: string) => string | undefined;
}): string {
	let result = template;
	if (context.vars) result = interpolate(result, context.vars);
	if (context.env) result = interpolateEnv(result, context.env);
	if (context.config) result = interpolateConfig(result, context.config);
	return result;
}
