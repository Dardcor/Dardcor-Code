/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface ExecutionRoot {
	readonly label: string;
}

export interface ExecutionEvent {
	readonly time: number;
	readonly label: string;
	readonly root: ExecutionRoot;
	readonly parent: ExecutionEvent | undefined;
	readonly detail?: string;
}

export interface ExecutionHistory {
	readonly roots: readonly ExecutionRoot[];
	readonly events: readonly ExecutionEvent[];
}


interface TraceLike {
	readonly parent: TraceLike | undefined;
	readonly root: { readonly label: string };
}

interface ScheduledTaskLike {
	readonly time: number;
	readonly source: { toString(): string; readonly stackTrace?: string };
	readonly trace?: TraceLike;
}

export interface LogEntryLike {
	readonly trace: TraceLike;
	readonly message: string;
}

export function buildHistoryFromTasks(
	tasks: readonly ScheduledTaskLike[],
	startTime: number,
	logs: readonly LogEntryLike[] = [],
): ExecutionHistory {
	const rootByTrace = new Map<unknown, ExecutionRoot>();
	const roots: ExecutionRoot[] = [];
	const eventByTrace = new Map<unknown, ExecutionEvent>();
	const taskEvents: ExecutionEvent[] = [];

	for (const task of tasks) {
		const trace = task.trace;
		if (!trace) { continue; }

		let root = rootByTrace.get(trace.root);
		if (!root) {
			root = { label: trace.root.label };
			rootByTrace.set(trace.root, root);
			roots.push(root);
		}

		let parentEvent: ExecutionEvent | undefined;
		for (let p = trace.parent; p; p = p.parent) {
			const e = eventByTrace.get(p);
			if (e) { parentEvent = e; break; }
		}

		const event: ExecutionEvent = {
			time: task.time - startTime,
			label: `${task.source}`,
			root,
			parent: parentEvent,
			detail: extractCallerFrame(task.source.stackTrace),
		};
		eventByTrace.set(trace, event);
		taskEvents.push(event);
	}

	const logsByParent = new Map<ExecutionEvent, ExecutionEvent[]>();
	for (const entry of logs) {
		let parentEvent: ExecutionEvent | undefined;
		for (let p: TraceLike | undefined = entry.trace; p; p = p.parent) {
			const e = eventByTrace.get(p);
			if (e) { parentEvent = e; break; }
		}
		if (!parentEvent) { continue; }

		const logEvent: ExecutionEvent = {
			time: parentEvent.time,
			label: `log: ${entry.message}`,
			root: parentEvent.root,
			parent: parentEvent,
		};
		const bucket = logsByParent.get(parentEvent);
		if (bucket) { bucket.push(logEvent); }
		else { logsByParent.set(parentEvent, [logEvent]); }
	}

	const events: ExecutionEvent[] = [];
	for (const e of taskEvents) {
		events.push(e);
		const ls = logsByParent.get(e);
		if (ls) { events.push(...ls); }
	}

	return { roots, events };
}

const _skipFramePatterns = [
	/[\\/]virtualScheduling[\\/]/,
	/[\\/]vs[\\/]base[\\/]common[\\/]async\./,
	/timeTravelScheduler|traceableTimeApi/,
	/RunOnceScheduler\.schedule/,
	/scheduleAtNextAnimationFrame/,
	/TimeoutTimer\.cancelAndSet/,
	/TimeoutTimer\.setIfNotSet/,
	/timeoutDeferred/,
	/createTimeout/,
];

const MAX_DETAIL_FRAMES = 5;

function extractCallerFrame(stackTrace: string | undefined): string | undefined {
	if (!stackTrace) { return undefined; }
	const frames: string[] = [];
	for (const line of stackTrace.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('at ')) { continue; }
		if (_skipFramePatterns.some(p => p.test(trimmed))) { continue; }
		frames.push(trimmed.slice(3));
		if (frames.length >= MAX_DETAIL_FRAMES) { break; }
	}
	return frames.length === 0 ? undefined : frames.join('\n');
}


export function renderSwimlanes(history: ExecutionHistory): string {
	const { roots, events } = history;
	if (events.length === 0) { return '(empty history)'; }
	if (roots.length === 0) {
		return events.map(e => `[+${e.time}ms] ${e.label}`).join('\n');
	}

	const n = events.length;

	const parentOf = new Array<number>(n).fill(-1);
	const childrenOf: number[][] = Array.from({ length: n }, () => []);
	const indexOfEvent = new Map<ExecutionEvent, number>();
	for (let i = 0; i < n; i++) { indexOfEvent.set(events[i], i); }
	for (let i = 0; i < n; i++) {
		const p = events[i].parent;
		if (p) {
			const pi = indexOfEvent.get(p);
			if (pi !== undefined) {
				parentOf[i] = pi;
				childrenOf[pi].push(i);
			}
		}
	}

	const isLastChild = new Array<boolean>(n).fill(false);
	for (let i = 0; i < n; i++) {
		const p = parentOf[i];
		if (p >= 0 && childrenOf[p][childrenOf[p].length - 1] === i) { isLastChild[i] = true; }
	}

	const COLLAPSE_DEPTH_THRESHOLD = 6;
	const depthOf = new Array<number>(n).fill(0);
	const slotOf = new Array<number>(n).fill(0);
	for (let i = 0; i < n; i++) {
		const p = parentOf[i];
		if (p >= 0) {
			depthOf[i] = depthOf[p] + 1;
			const collapse = isLastChild[i] && depthOf[i] >= COLLAPSE_DEPTH_THRESHOLD;
			slotOf[i] = slotOf[p] + (collapse ? 0 : 1);
		}
	}

	const displayLabelOf = new Array<string>(n);
	const detailLinesOf = new Array<readonly string[]>(n);
	for (let i = 0; i < n; i++) {
		const e = events[i];
		const frames = e.detail ? e.detail.split('\n') : [];
		displayLabelOf[i] = frames.length > 0 ? `${e.label} · ${frames[0]}` : e.label;
		detailLinesOf[i] = frames.slice(1);
	}

	const widthOf = new Map<ExecutionRoot, number>();
	for (const r of roots) { widthOf.set(r, r.label.length); }
	for (let i = 0; i < n; i++) {
		const baseIndent = slotOf[i] * 3 + 3;
		const maxLen = Math.max(displayLabelOf[i].length, ...detailLinesOf[i].map(l => l.length + 2));
		const w = baseIndent + maxLen;
		const cur = widthOf.get(events[i].root) ?? 0;
		if (w > cur) { widthOf.set(events[i].root, w); }
	}

	const maxTime = n > 0 ? Math.max(...events.map(e => Math.round(e.time))) : 0;
	const timeColWidth = `+${maxTime}ms`.length;

	const lines: string[] = [];

	const header: string[] = [];
	for (const r of roots) {
		const w = widthOf.get(r)!;
		header.push(r.label.padStart(Math.ceil((w + r.label.length) / 2)).padEnd(w));
	}
	lines.push(`${' '.repeat(timeColWidth)} ${header.join('  ')}`.trimEnd());

	const lastChildOf = new Array<number>(n).fill(-1);
	for (let i = 0; i < n; i++) {
		const kids = childrenOf[i];
		if (kids.length > 0) { lastChildOf[i] = kids[kids.length - 1]; }
	}

	const laneStacks = new Map<ExecutionRoot, Set<number>>();
	for (const r of roots) { laneStacks.set(r, new Set()); }

	for (let i = 0; i < n; i++) {
		const event = events[i];
		const timeStr = `+${Math.round(event.time)}ms`.padStart(timeColWidth);

		const parts: string[] = [];
		for (const r of roots) {
			const w = widthOf.get(r)!;
			const stack = laneStacks.get(r)!;

			if (r === event.root) {
				const slot = slotOf[i];
				const indent: string[] = [];
				for (let s = 0; s < slot; s++) {
					let hasActive = false;
					for (const a of stack) {
						if (slotOf[a] === s && lastChildOf[a] > i) { hasActive = true; break; }
					}
					indent.push(hasActive ? '│  ' : '   ');
				}
				const prefix = isLastChild[i] ? '└─ ' : '├─ ';
				parts.push(`${indent.join('')}${prefix}${displayLabelOf[i]}`.padEnd(w));
			} else {
				const activeSlots: number[] = [];
				for (const a of stack) {
					if (lastChildOf[a] > i) { activeSlots.push(slotOf[a]); }
				}
				const maxSlot = Math.max(...activeSlots, -1);
				const chars: string[] = new Array(Math.max(maxSlot + 1, 0)).fill('   ');
				for (const s of activeSlots) { chars[s] = '│  '; }

				let nextJ = -1;
				for (let j = i + 1; j < n; j++) {
					if (events[j].root === r) { nextJ = j; break; }
				}
				if (nextJ >= 0 && parentOf[nextJ] >= 0) {
					const s = slotOf[nextJ];
					if (!isLastChild[nextJ]) {
						while (chars.length <= s) { chars.push('   '); }
						if (chars[s] === '   ') { chars[s] = '|  '; }
					}
				}

				while (chars.length > 0 && chars[chars.length - 1] === '   ') { chars.pop(); }
				parts.push(chars.join('').padEnd(w));
			}
		}

		lines.push(`${timeStr} ${parts.join('  ')}`.trimEnd());

		const extras = detailLinesOf[i];
		if (extras.length > 0) {
			const slot = slotOf[i];
			const stackForExtras = laneStacks.get(event.root)!;
			const hasOpenChildren = childrenOf[i].length > 0;
			const extraIndent: string[] = [];
			for (let s = 0; s < slot; s++) {
				let hasActive = false;
				for (const a of stackForExtras) {
					if (slotOf[a] === s && lastChildOf[a] > i) { hasActive = true; break; }
				}
				extraIndent.push(hasActive ? '│  ' : '   ');
			}
			extraIndent.push(hasOpenChildren ? '│  ' : '   ');
			for (const extra of extras) {
				const extrasParts: string[] = [];
				for (const r of roots) {
					const w = widthOf.get(r)!;
					if (r === event.root) {
						extrasParts.push(`${extraIndent.join('')}${extra}`.padEnd(w));
					} else {
						const otherStack = laneStacks.get(r)!;
						const activeSlots: number[] = [];
						for (const a of otherStack) {
							if (lastChildOf[a] > i) { activeSlots.push(slotOf[a]); }
						}
						const maxSlot = Math.max(...activeSlots, -1);
						const chars: string[] = new Array(Math.max(maxSlot + 1, 0)).fill('   ');
						for (const s of activeSlots) { chars[s] = '│  '; }
						while (chars.length > 0 && chars[chars.length - 1] === '   ') { chars.pop(); }
						extrasParts.push(chars.join('').padEnd(w));
					}
				}
				const timePad = ' '.repeat(timeColWidth);
				lines.push(`${timePad} ${extrasParts.join('  ')}`.trimEnd());
			}
		}

		const stack = laneStacks.get(event.root)!;
		if (childrenOf[i].length > 0) { stack.add(i); }
		let cur = i;
		while (isLastChild[cur]) {
			const p = parentOf[cur];
			if (p < 0) { break; }
			stack.delete(p);
			cur = p;
		}
	}

	return lines.join('\n');
}


export function renderLaneGraph(history: ExecutionHistory): string {
	const { events } = history;
	if (events.length === 0) { return ''; }

	interface Node {
		readonly label: string;
		readonly parent: Node | undefined;
		readonly isSynthetic: boolean;
	}

	const nodes: Node[] = [];
	const syntheticForRoot = new Map<ExecutionRoot, Node>();
	const nodeByEvent = new Map<ExecutionEvent, Node>();

	const rootsWithChildren = new Set<ExecutionRoot>();
	for (const e of events) { if (!e.parent) { rootsWithChildren.add(e.root); } }

	for (const e of events) {
		if (rootsWithChildren.has(e.root) && !syntheticForRoot.has(e.root)) {
			const syn: Node = { label: `+${e.root.label}`, parent: undefined, isSynthetic: true };
			syntheticForRoot.set(e.root, syn);
			nodes.push(syn);
		}
		const timeStr = `+${e.time}ms`.padStart(7);
		const parent = e.parent ? nodeByEvent.get(e.parent)! : syntheticForRoot.get(e.root);
		const node: Node = { label: `[${timeStr}] ${e.label}`, parent, isSynthetic: false };
		nodeByEvent.set(e, node);
		nodes.push(node);
	}

	const n = nodes.length;
	const parentOf = new Array<number>(n).fill(-1);
	const childrenOf: number[][] = Array.from({ length: n }, () => []);
	const indexOfNode = new Map<Node, number>();
	for (let i = 0; i < n; i++) { indexOfNode.set(nodes[i], i); }
	for (let i = 0; i < n; i++) {
		const p = nodes[i].parent;
		if (p) {
			const pi = indexOfNode.get(p);
			if (pi !== undefined) { parentOf[i] = pi; childrenOf[pi].push(i); }
		}
	}

	const colOf = new Array<number>(n).fill(-1);
	let totalCols = 0;
	for (let i = 0; i < n; i++) {
		if (childrenOf[i].length > 0) { colOf[i] = totalCols++; }
	}

	if (totalCols === 0) {
		return events.map(e => `[+${`${e.time}ms`.padStart(5)}] ${e.label}`).join('\n');
	}

	const active = new Array<number>(totalCols).fill(-1);
	const lines: string[] = [];

	for (let i = 0; i < n; i++) {
		const node = nodes[i];
		const pIdx = parentOf[i];
		const connectCol = pIdx >= 0 ? colOf[pIdx] : -1;
		const last = pIdx >= 0 && childrenOf[pIdx][childrenOf[pIdx].length - 1] === i;
		const opensCol = childrenOf[i].length > 0 ? colOf[i] : -1;
		const horizEnd = pIdx >= 0 ? (opensCol >= 0 ? opensCol : totalCols) : -1;

		const chars: string[] = [];
		for (let c = 0; c < totalCols; c++) {
			const isActive = active[c] >= 0;
			const isConnect = c === connectCol;
			const isOpen = c === opensCol && !isConnect;
			const inHoriz = connectCol >= 0 && c > connectCol && c < horizEnd;

			let g: string, s: string;
			if (isConnect) {
				g = last ? '└' : '├';
				s = '─';
			} else if (isOpen && node.isSynthetic) {
				g = '+';
				s = node.label.slice(1, 2) || '?';
			} else if (isOpen && connectCol >= 0) {
				g = '╷'; s = '─';
			} else if (isOpen) {
				g = '╷'; s = ' ';
			} else if (inHoriz && isActive) {
				g = '┼'; s = '─';
			} else if (inHoriz) {
				g = '─'; s = '─';
			} else if (isActive) {
				g = '│'; s = ' ';
			} else {
				g = ' '; s = ' ';
			}
			chars.push(g, s);
		}

		if (last) { active[colOf[pIdx]] = -1; }
		if (opensCol >= 0) { active[opensCol] = i; }

		if (node.isSynthetic) {
			lines.push(chars.join('').trimEnd());
		} else {
			lines.push(`${chars.join('')}${node.label}`);
		}
	}

	return lines.join('\n');
}
