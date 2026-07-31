/**
 * Dardcor Code - Comparators (Task 58)
 * Mirrors: vs/base/common/comparers.ts
 */

const intlFileNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareFileNames(one: string | null, other: string | null): number {
	if (one === other) return 0;
	if (!one) return -1;
	if (!other) return 1;
	return intlFileNameCollator.compare(one, other);
}

export function compareFileExtensions(one: string | null, other: string | null): number {
	if (one === other) return 0;
	if (!one) return -1;
	if (!other) return 1;
	const oneExt = getExtension(one);
	const otherExt = getExtension(other);
	const extResult = intlFileNameCollator.compare(oneExt, otherExt);
	if (extResult !== 0) return extResult;
	return intlFileNameCollator.compare(one, other);
}

function getExtension(name: string): string {
	const dotIdx = name.lastIndexOf('.');
	return dotIdx >= 0 ? name.substring(dotIdx + 1) : '';
}

export function compareAnything(one: string, other: string, lookFor: string): number {
	const elementAName = one.toLowerCase();
	const elementBName = other.toLowerCase();
	const prefixA = elementAName.startsWith(lookFor) ? -1 : 0;
	const prefixB = elementBName.startsWith(lookFor) ? -1 : 0;
	if (prefixA !== prefixB) return prefixA - prefixB;
	const containsA = elementAName.includes(lookFor) ? -1 : 0;
	const containsB = elementBName.includes(lookFor) ? -1 : 0;
	if (containsA !== containsB) return containsA - containsB;
	return intlFileNameCollator.compare(elementAName, elementBName);
}

export function compareSemVer(a: string, b: string): number {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		const na = pa[i] || 0;
		const nb = pb[i] || 0;
		if (na !== nb) return na - nb;
	}
	return 0;
}

export function numberComparator(a: number, b: number): number {
	return a - b;
}

export function booleanComparator(a: boolean, b: boolean): number {
	return (a ? 1 : 0) - (b ? 1 : 0);
}
