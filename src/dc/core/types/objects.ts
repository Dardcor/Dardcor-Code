/**
 * Dardcor Code - Object Utilities (Task 60)
 * Mirrors: vs/base/common/objects.ts
 */

export function deepClone<T>(obj: T): T {
	if (!obj || typeof obj !== 'object') return obj;
	if (obj instanceof RegExp) return obj;
	const result: any = Array.isArray(obj) ? [] : {};
	Object.entries(obj as any).forEach(([key, value]) => {
		result[key] = value && typeof value === 'object' ? deepClone(value) : value;
	});
	return result;
}

export function deepFreeze<T>(obj: T): T {
	if (!obj || typeof obj !== 'object') return obj;
	const stack: any[] = [obj];
	while (stack.length > 0) {
		const current = stack.shift();
		Object.freeze(current);
		for (const key in current) {
			if (Object.prototype.hasOwnProperty.call(current, key)) {
				const prop = current[key];
				if (typeof prop === 'object' && prop !== null && !Object.isFrozen(prop)) {
					stack.push(prop);
				}
			}
		}
	}
	return obj;
}

export function cloneAndChange(obj: any, changer: (orig: any) => any): any {
	return _cloneAndChange(obj, changer, new Set());
}

function _cloneAndChange(obj: any, changer: (orig: any) => any, seen: Set<any>): any {
	if (obj === undefined || obj === null) return obj;
	const changed = changer(obj);
	if (typeof changed !== 'undefined') return changed;
	if (Array.isArray(obj)) {
		return obj.map(e => _cloneAndChange(e, changer, seen));
	}
	if (typeof obj === 'object') {
		if (seen.has(obj)) throw new Error('Cannot clone recursive data-structure');
		seen.add(obj);
		const result: Record<string, unknown> = {};
		for (const key in obj) {
			if (Object.prototype.hasOwnProperty.call(obj, key)) {
				result[key] = _cloneAndChange(obj[key], changer, seen);
			}
		}
		seen.delete(obj);
		return result;
	}
	return obj;
}

export function mixin(destination: any, source: any, overwrite: boolean = true): any {
	if (!isObject(destination)) return source;
	if (isObject(source)) {
		Object.keys(source).forEach(key => {
			if (key in destination) {
				if (overwrite) {
					if (isObject(destination[key]) && isObject(source[key])) {
						mixin(destination[key], source[key], overwrite);
					} else {
						destination[key] = source[key];
					}
				}
			} else {
				destination[key] = source[key];
			}
		});
	}
	return destination;
}

export function equals(one: any, other: any): boolean {
	if (one === other) return true;
	if (one === null || one === undefined || other === null || other === undefined) return false;
	if (typeof one !== typeof other) return false;
	if (typeof one !== 'object') return false;
	if (Array.isArray(one) !== Array.isArray(other)) return false;
	if (Array.isArray(one)) {
		if (one.length !== other.length) return false;
		for (let i = 0; i < one.length; i++) {
			if (!equals(one[i], other[i])) return false;
		}
		return true;
	}
	const oneKeys = Object.keys(one);
	const otherKeys = Object.keys(other);
	if (oneKeys.length !== otherKeys.length) return false;
	for (const key of oneKeys) {
		if (!equals(one[key], other[key])) return false;
	}
	return true;
}

function isObject(obj: any): obj is Object {
	return typeof obj === 'object' && obj !== null && !Array.isArray(obj) && !(obj instanceof RegExp) && !(obj instanceof Date);
}

export function getAllPropertyNames(obj: object): string[] {
	let res: string[] = [];
	let proto = Object.getPrototypeOf(obj);
	while (Object.prototype !== proto) {
		res = res.concat(Object.getOwnPropertyNames(proto));
		proto = Object.getPrototypeOf(proto);
	}
	return res;
}

export function getAllMethodNames(obj: object): string[] {
	const methods: string[] = [];
	for (const prop of getAllPropertyNames(obj)) {
		if (typeof (obj as any)[prop] === 'function') {
			methods.push(prop);
		}
	}
	return methods;
}

export function createProxyObject<T extends object>(methodNames: string[], invoke: (method: string, args: unknown[]) => unknown): T {
	const result = Object.create(null);
	for (const method of methodNames) {
		result[method] = function (...args: unknown[]) {
			return invoke(method, args);
		};
	}
	return result;
}
