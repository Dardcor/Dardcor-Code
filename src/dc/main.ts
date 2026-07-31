/**
 * Dardcor Code - Application Native Desktop Entry Point
 */

import { WorkbenchLayout } from './app-shell/layout/workbench-layout.js';
import { ExplorerViewlet } from './modules/explorer/explorer-viewlet.js';
import { CodeEditor } from './engine/controller/editor-controller.js';
import { TextModel } from './engine/model/text-model.js';
import { URI } from './core/types/uri.js';

declare const require: any;

export function bootstrapDardcorCode(): void {
	document.addEventListener('DOMContentLoaded', () => {
		// 1. Initialize Master Workbench Shell
		const workbench = new WorkbenchLayout(document.body);

		// Render TitleBar with Application Logo & Menu
		workbench.titleBarDom.innerHTML = `
			<div style="display:flex;align-items:center;gap:10px;">
				<img src="./public/dardcor-code.png" style="width:18px;height:18px;object-fit:contain;" alt="Dardcor Code Logo">
				<span style="font-weight:600;color:#ffffff;font-size:13px;">Dardcor Code</span>
				<div style="display:flex;gap:12px;margin-left:15px;color:#cccccc;font-size:12px;">
					<span id="btn-open-file" style="cursor:pointer;padding:2px 6px;border-radius:3px;">File</span>
					<span id="btn-open-folder" style="cursor:pointer;padding:2px 6px;border-radius:3px;">Folder</span>
					<span style="cursor:pointer;padding:2px 6px;border-radius:3px;">Edit</span>
					<span style="cursor:pointer;padding:2px 6px;border-radius:3px;">View</span>
					<span style="cursor:pointer;padding:2px 6px;border-radius:3px;">Terminal</span>
					<span style="cursor:pointer;padding:2px 6px;border-radius:3px;">Help</span>
				</div>
			</div>
			<div style="color:#888888;font-size:11px;">Dardcor Code Desktop Engine</div>
		`;

		// Add ActivityBar Icons
		workbench.activityBarDom.innerHTML = `
			<div class="dc-activity-icon active" title="Explorer (Ctrl+Shift+E)">📁</div>
			<div class="dc-activity-icon" title="Search (Ctrl+Shift+F)">🔍</div>
			<div class="dc-activity-icon" title="Source Control (Ctrl+Shift+G)">🌿</div>
			<div class="dc-activity-icon" title="Run and Debug (Ctrl+Shift+D)">🐞</div>
			<div class="dc-activity-icon" title="Extensions (Ctrl+Shift+X)">🧩</div>
		`;

		// 2. Attach File Explorer to SideBar
		new ExplorerViewlet(workbench.sideBarDom);

		// 3. Attach CodeEditor to Center Editor Part
		const editor = new CodeEditor(workbench.editorPartDom);
		const initialModel = new TextModel(
			URI.file('/workspace/main.ts'),
			`// Welcome to Dardcor Code - Native Desktop Application\n// Logo: public/dardcor-code.png & public/dardcor-code.ico\n\nfunction helloDardcor() {\n    console.log("Dardcor Code Native Desktop Engine Initialized!");\n}\n\nhelloDardcor();`
		);

		editor.setModel(initialModel);
		editor.focus();

		// 4. Panel Section (Terminal & Output)
		workbench.panelPartDom.innerHTML = `
			<div style="height:28px;background:#252526;display:flex;align-items:center;padding:0 10px;gap:15px;font-size:11px;font-weight:600;border-bottom:1px solid #1e1e1e;">
				<span style="color:#ffffff;border-bottom:2px solid #007acc;padding-bottom:4px;">TERMINAL</span>
				<span style="color:#888888;cursor:pointer;">OUTPUT</span>
				<span style="color:#888888;cursor:pointer;">PROBLEMS</span>
				<span style="color:#888888;cursor:pointer;">DEBUG CONSOLE</span>
			</div>
			<div style="flex:1;padding:10px;font-family:Consolas, monospace;font-size:12px;color:#cccccc;background:#1e1e1e;overflow:auto;">
				<div style="color:#4ec9b0;">PS C:\\Users\\Dardcor\\Documents\\Code Editor\\Dardcor-Code-New&gt; dardcor --version</div>
				<div style="color:#dcdcaa;">Dardcor Code v1.0.0 (x64-win32) Electron Desktop Kernel</div>
				<div style="color:#6a9955;margin-top:5px;">Ready for native execution.</div>
			</div>
		`;

		// 5. Native File / Folder Dialog Bindings (if running in Electron)
		if (typeof require !== 'undefined') {
			try {
				const { ipcRenderer } = require('electron');
				document.getElementById('btn-open-file')?.addEventListener('click', async () => {
					const filePath = await ipcRenderer.invoke('dialog:openFile');
					if (filePath) {
						const res = await ipcRenderer.invoke('fs:readFile', filePath);
						if (res.content !== undefined) {
							const newModel = new TextModel(URI.file(filePath), res.content);
							editor.setModel(newModel);
						}
					}
				});
				document.getElementById('btn-open-folder')?.addEventListener('click', async () => {
					const folderPath = await ipcRenderer.invoke('dialog:openFolder');
					if (folderPath) {
						alert(`Selected workspace folder: ${folderPath}`);
					}
				});
			} catch {
				// Non-electron web environment fallback
			}
		}

		// 6. Update Status Bar
		workbench.statusBarDom.innerHTML = `
			<div style="display:flex;align-items:center;gap:15px;">
				<span>🟢 Main</span>
				<span>0 errors, 0 warnings</span>
			</div>
			<div style="display:flex;align-items:center;gap:15px;">
				<span>Ln 1, Col 1</span>
				<span>Spaces: 4</span>
				<span>UTF-8</span>
				<span>TypeScript</span>
				<span>Dardcor Code v1.0.0</span>
			</div>
		`;
	});
}

bootstrapDardcorCode();
