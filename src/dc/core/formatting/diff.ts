/**
 * Dardcor Code - Myers LCS Text Diff (Task 73)
 * Mirrors: vs/base/common/diff/diff.ts
 */

export interface IChange {
	readonly originalStart: number;
	readonly originalLength: number;
	readonly modifiedStart: number;
	readonly modifiedLength: number;
}

export interface ILineChange extends IChange {
	readonly originalEndLineNumber: number;
	readonly modifiedEndLineNumber: number;
}

export function computeDiff(originalLines: string[], modifiedLines: string[]): IChange[] {
	const N = originalLines.length;
	const M = modifiedLines.length;
	const MAX = N + M;

	if (MAX === 0) return [];
	if (N === 0) return [{ originalStart: 0, originalLength: 0, modifiedStart: 0, modifiedLength: M }];
	if (M === 0) return [{ originalStart: 0, originalLength: N, modifiedStart: 0, modifiedLength: 0 }];

	// Myers diff algorithm
	const V: Map<number, number>[] = [];
	const trace: Map<number, number>[] = [];

	outer:
	for (let d = 0; d <= MAX; d++) {
		const Vd = new Map<number, number>();
		V.push(Vd);

		if (d === 0) {
			let x = 0;
			while (x < N && x < M && originalLines[x] === modifiedLines[x]) x++;
			Vd.set(0, x);
			if (x >= N && x >= M) break;
			trace.push(new Map(Vd));
			continue;
		}

		const prev = V[d - 1];
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (k === -d || (k !== d && (prev.get(k - 1) ?? 0) < (prev.get(k + 1) ?? 0))) {
				x = prev.get(k + 1) ?? 0;
			} else {
				x = (prev.get(k - 1) ?? 0) + 1;
			}
			let y = x - k;
			while (x < N && y < M && originalLines[x] === modifiedLines[y]) {
				x++;
				y++;
			}
			Vd.set(k, x);
			if (x >= N && y >= M) {
				trace.push(new Map(Vd));
				break outer;
			}
		}
		trace.push(new Map(Vd));
	}

	// Backtrack to find changes
	return backtrack(trace, originalLines, modifiedLines);
}

function backtrack(trace: Map<number, number>[], original: string[], modified: string[]): IChange[] {
	const changes: IChange[] = [];
	let x = original.length;
	let y = modified.length;

	for (let d = trace.length - 1; d >= 0; d--) {
		const k = x - y;
		const V = trace[d];

		let prevK: number;
		if (d === 0) {
			prevK = 0;
		} else {
			const prevV = trace[d - 1];
			if (k === -d || (k !== d && (prevV.get(k - 1) ?? 0) < (prevV.get(k + 1) ?? 0))) {
				prevK = k + 1;
			} else {
				prevK = k - 1;
			}
		}

		let prevX: number;
		if (d === 0) {
			prevX = 0;
		} else {
			const prevV = trace[d - 1];
			if (k === -d || (k !== d && (prevV.get(k - 1) ?? 0) < (prevV.get(k + 1) ?? 0))) {
				prevX = prevV.get(k + 1) ?? 0;
			} else {
				prevX = (prevV.get(k - 1) ?? 0) + 1;
			}
		}
		let prevY = prevX - prevK;

		// Skip the snake (equal lines)
		while (x > prevX && y > prevY) {
			x--;
			y--;
		}

		if (d > 0) {
			if (x === prevX) {
				// Insertion
				changes.unshift({
					originalStart: x,
					originalLength: 0,
					modifiedStart: prevY,
					modifiedLength: 1,
				});
			} else {
				// Deletion
				changes.unshift({
					originalStart: prevX,
					originalLength: 1,
					modifiedStart: y,
					modifiedLength: 0,
				});
			}
		}

		x = prevX;
		y = prevY;
	}

	// Merge adjacent changes
	return mergeChanges(changes);
}

function mergeChanges(changes: IChange[]): IChange[] {
	if (changes.length <= 1) return changes;
	const merged: IChange[] = [changes[0]];
	for (let i = 1; i < changes.length; i++) {
		const last = merged[merged.length - 1];
		const current = changes[i];
		if (last.originalStart + last.originalLength === current.originalStart &&
			last.modifiedStart + last.modifiedLength === current.modifiedStart) {
			merged[merged.length - 1] = {
				originalStart: last.originalStart,
				originalLength: last.originalLength + current.originalLength,
				modifiedStart: last.modifiedStart,
				modifiedLength: last.modifiedLength + current.modifiedLength,
			};
		} else {
			merged.push(current);
		}
	}
	return merged;
}

export function computeLineChanges(originalLines: string[], modifiedLines: string[]): ILineChange[] {
	return computeDiff(originalLines, modifiedLines).map(c => ({
		...c,
		originalEndLineNumber: c.originalStart + c.originalLength,
		modifiedEndLineNumber: c.modifiedStart + c.modifiedLength,
	}));
}
