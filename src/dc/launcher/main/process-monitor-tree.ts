import { app } from 'electron';

export interface ProcessInfo {
	pid: number;
	name: string;
	type: string;
	cpu: number;
	memory: number;
	children: ProcessInfo[];
}

export interface ProcessTreeOptions {
	includeChildren?: boolean;
	includeCpu?: boolean;
}

const TYPE_NAMES: Record<string, string> = {
	main: 'Main Process',
	renderer: 'Renderer',
	gpu: 'GPU Process',
	utility: 'Utility',
	tab: 'Tab',
	zygote: 'Zygote',
	crashpad: 'Crashpad',
	sandbox: 'Sandbox Helper',
	pepper: 'Pepper Plugin'
};

export function getProcessTypeName(type: string): string {
	return TYPE_NAMES[type] ?? type;
}

export function getMainProcessInfo(): ProcessInfo {
	return {
		pid: process.pid,
		name: process.title || 'Dardcor Code',
		type: 'main',
		cpu: 0,
		memory: process.memoryUsage().rss,
		children: []
	};
}

export async function getProcessTree(options: ProcessTreeOptions = {}): Promise<ProcessInfo[]> {
	const main = getMainProcessInfo();
	try {
		if (options.includeChildren ?? true) {
			const metrics = app.getAppMetrics();
			const children: ProcessInfo[] = metrics.map((metric) => ({
				pid: metric.pid,
				name: getProcessTypeName(metric.type),
				type: metric.type,
				cpu: typeof (metric as any).cpu === 'number' ? (metric as any).cpu : 0,
				memory: typeof (metric as any).memory === 'number'
					? (metric as any).memory
					: typeof (metric as any).memory?.workingSetSize === 'number'
						? (metric as any).memory.workingSetSize
						: 0,
				children: []
			}));
			main.children = children;
		}
	} catch (err) {
		console.warn('[process-monitor-tree] getAppMetrics failed:', err);
	}
	return [main];
}

export async function getProcessTreeWithWebContents(): Promise<ProcessInfo[]> {
	const [tree] = await getProcessTree();
	try {
		const { webContents } = await import('electron');
		const allContents = webContents.getAllWebContents();
		for (const wc of allContents) {
			try {
				const info = await (wc as any).getProcessMemoryInfo?.();
				if (!info) {
					continue;
				}
				tree.children.push({
					pid: info.pid ?? -1,
					name: `WebContents: ${wc.getTitle() || wc.getURL()}`,
					type: 'webContents',
					cpu: 0,
					memory: info.workingSetSize ?? 0,
					children: []
				});
			} catch {
				// Ignore.
			}
		}
	} catch {
		// Ignore.
	}
	return [tree];
}

export function flattenProcessTree(processes: ProcessInfo[]): ProcessInfo[] {
	const result: ProcessInfo[] = [];
	const visit = (node: ProcessInfo): void => {
		result.push(node);
		for (const child of node.children ?? []) {
			visit(child);
		}
	};
	for (const node of processes) {
		visit(node);
	}
	return result;
}

export function getTotalMemoryUsage(processes: ProcessInfo[]): number {
	return flattenProcessTree(processes).reduce((sum, p) => sum + (p.memory ?? 0), 0);
}

export function getProcessCount(processes: ProcessInfo[]): number {
	return flattenProcessTree(processes).length;
}

export function findProcessByPid(processes: ProcessInfo[], pid: number): ProcessInfo | null {
	return flattenProcessTree(processes).find((p) => p.pid === pid) ?? null;
}
