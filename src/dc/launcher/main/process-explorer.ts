import { BrowserWindow, dialog } from 'electron';
import { getProcessTree, ProcessInfo } from './process-monitor-tree.js';
import { formatBytes } from './native-file-trash.js';

export function getProcessList(): ProcessInfo[] {
	return getProcessTreeSync();
}

export function getProcessTreeSync(): ProcessInfo[] {
	const root: ProcessInfo = {
		pid: process.pid,
		name: process.title || 'Dardcor Code',
		type: 'main',
		cpu: 0,
		memory: process.memoryUsage().rss,
		children: []
	};
	return [root];
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function buildProcessTableHtml(processes: ProcessInfo[]): string {
	const rows: string[] = [];
	const visit = (process: ProcessInfo, depth: number): void => {
		const indent = '&nbsp;'.repeat(depth * 3);
		rows.push(`<tr>
			<td>${indent}${escapeHtml(process.name)}</td>
			<td>${process.pid}</td>
			<td>${process.type}</td>
			<td>${(process.cpu ?? 0).toFixed(1)}%</td>
			<td>${formatBytes(process.memory ?? 0)}</td>
		</tr>`);
		for (const child of process.children ?? []) {
			visit(child, depth + 1);
		}
	};
	for (const process of processes) {
		visit(process, 0);
	}
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Process Explorer - Dardcor Code</title>
<style>
	body { font-family: Segoe UI, sans-serif; background: #1e1e1e; color: #cccccc; margin: 0; padding: 16px; }
	h1 { font-size: 16px; color: #ffffff; }
	table { border-collapse: collapse; width: 100%; font-size: 12px; }
	th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #333333; }
	th { color: #ffffff; background: #252526; position: sticky; top: 0; }
	tr:hover { background: #2a2d2e; }
	.stats { color: #9cdcfe; margin-bottom: 12px; }
</style>
</head>
<body>
<h1>Process Explorer</h1>
<div class="stats">PID: ${process.pid} | Memory: ${formatBytes(process.memoryUsage().rss)} | Platform: ${process.platform}</div>
<table>
<thead><tr><th>Name</th><th>PID</th><th>Type</th><th>CPU</th><th>Memory</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>
</body>
</html>`;
}

export async function openProcessExplorer(): Promise<boolean> {
	try {
		const processes = await getProcessTree();
		const html = buildProcessTableHtml(processes);
		const win = new BrowserWindow({
			width: 800,
			height: 600,
			title: 'Process Explorer - Dardcor Code',
			autoHideMenuBar: true,
			backgroundColor: '#1e1e1e',
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true
			}
		});
		await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
		return true;
	} catch (err) {
		console.error('[process-explorer] failed to open explorer:', err);
		try {
			const processes = await getProcessTree();
			const summary = processes
				.map((p) => `${p.name} (PID ${p.pid}): ${formatBytes(p.memory ?? 0)}`)
				.join('\n');
			dialog.showMessageBox({
				type: 'info',
				title: 'Process Explorer',
				message: 'Process List',
				detail: summary,
				buttons: ['OK']
			});
			return true;
		} catch {
			return false;
		}
	}
}

export async function getProcessSummary(): Promise<string> {
	const processes = await getProcessTree();
	return processes.map((p) => `${p.name}: ${formatBytes(p.memory ?? 0)}`).join('\n');
}
