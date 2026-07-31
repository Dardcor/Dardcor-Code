/**
 * Dardcor Code - String Hashing Utilities
 */

export function stringHash(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = (hash * 33) ^ str.charCodeAt(i);
	}
	return hash >>> 0;
}

export function murmur3Hash(str: string): number {
	let h1 = 0xdeadbeef;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
	}
	return (h1 ^ (h1 >>> 16)) >>> 0;
}
