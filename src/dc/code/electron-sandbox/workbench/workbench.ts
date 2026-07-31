/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-globals */

(async function () {
	// Mark start of renderer
	performance.mark('dc/didStartRenderer');

	function showSplash() {
		performance.mark('dc/willShowPartsSplash');
		const style = document.createElement('style');
		style.className = 'initialShellColors';
		window.document.head.appendChild(style);
		style.textContent = `body { background-color: #000000; color: #FFFFFF; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }`;

		const splash = document.createElement('div');
		splash.id = 'dc-parts-splash';
		splash.className = 'dc-dark';
		
		const titleBar = document.createElement('div');
		titleBar.style.height = '35px';
		titleBar.style.backgroundColor = '#000000';
		titleBar.style.display = 'flex';
		titleBar.style.alignItems = 'center';
		titleBar.style.paddingLeft = '10px';
		titleBar.style.setProperty('-webkit-app-region', 'drag'); // Allow dragging
		titleBar.innerText = 'Dardcor Code';
		
		const content = document.createElement('div');
		content.style.display = 'flex';
		content.style.height = 'calc(100vh - 35px)';
		content.style.justifyContent = 'center';
		content.style.alignItems = 'center';
		content.innerText = 'Loading Dardcor Code...';

		splash.appendChild(titleBar);
		splash.appendChild(content);
		document.body.appendChild(splash);
		
		performance.mark('dc/didShowPartsSplash');
	}

	try {
		showSplash();

		// Simulate initialization delay
		await new Promise(resolve => setTimeout(resolve, 500));

		// Clean up splash
		const splash = document.getElementById('dc-parts-splash');
		if (splash) {
			splash.remove();
		}

		// Initialize actual workbench
		const workbenchContainer = document.createElement('div');
		workbenchContainer.id = 'workbench.main.container';
		workbenchContainer.style.width = '100vw';
		workbenchContainer.style.height = '100vh';
		workbenchContainer.style.display = 'flex';
		workbenchContainer.style.flexDirection = 'column';

		const header = document.createElement('header');
		header.style.height = '35px';
		header.style.backgroundColor = '#1e1e1e';
		header.style.color = '#ccc';
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.padding = '0 10px';
		header.style.setProperty('-webkit-app-region', 'drag');
		header.innerText = 'Dardcor Code - Editor';
		
		const mainArea = document.createElement('div');
		mainArea.style.display = 'flex';
		mainArea.style.flex = '1';
		mainArea.style.backgroundColor = '#252526';
		mainArea.style.color = '#fff';
		
		const sideBar = document.createElement('aside');
		sideBar.style.width = '250px';
		sideBar.style.backgroundColor = '#252526';
		sideBar.style.borderRight = '1px solid #3c3c3c';
		sideBar.style.padding = '10px';
		sideBar.innerText = 'Explorer';
		
		const editorArea = document.createElement('main');
		editorArea.style.flex = '1';
		editorArea.style.backgroundColor = '#1e1e1e';
		editorArea.style.padding = '10px';
		editorArea.innerText = 'Editor Area';

		mainArea.appendChild(sideBar);
		mainArea.appendChild(editorArea);

		const statusBar = document.createElement('footer');
		statusBar.style.height = '22px';
		statusBar.style.backgroundColor = '#007acc';
		statusBar.style.color = '#fff';
		statusBar.style.fontSize = '12px';
		statusBar.style.display = 'flex';
		statusBar.style.alignItems = 'center';
		statusBar.style.padding = '0 10px';
		statusBar.innerText = 'Ready';

		workbenchContainer.appendChild(header);
		workbenchContainer.appendChild(mainArea);
		workbenchContainer.appendChild(statusBar);

		document.body.appendChild(workbenchContainer);

	} catch (error) {
		console.error('Failed to load Dardcor Code', error);
		document.body.innerText = 'Failed to load Dardcor Code: ' + (error as Error).message;
	}
})();
