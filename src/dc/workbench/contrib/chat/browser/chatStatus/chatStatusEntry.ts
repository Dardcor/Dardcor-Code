/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../../services/statusbar/browser/statusbar.js';
import { registerAction2, Action2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';

import { Codicon } from '../../../../../base/common/codicons.js';
import { IWebviewWorkbenchService } from '../../../webviewPanel/browser/webviewWorkbenchService.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';

let activeDardcorRouterInput: WebviewInput | undefined;

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'dardcor.model.open',
			title: { value: localize('openDardcorModel', "Open Dardcor Code"), original: 'Open Dardcor Code' }
		});
	}
	async run(accessor: ServicesAccessor) {
		const webviewWorkbenchService = accessor.get(IWebviewWorkbenchService);
		const editorGroupService = accessor.get(IEditorGroupsService);
		const title = 'Dardcor Code';

		if (activeDardcorRouterInput && !activeDardcorRouterInput.isDisposed()) {
			webviewWorkbenchService.revealWebview(activeDardcorRouterInput, editorGroupService.activeGroup, false);
			return;
		}

		const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: #09090b;
    color: #e4e4e7;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
  }
  #loader {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: #09090b;
    z-index: 10;
    transition: opacity 0.3s ease;
  }
  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(168, 85, 247, 0.2);
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .text {
    font-size: 14px;
    color: #a1a1aa;
  }
  iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: #09090b;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  iframe.loaded {
    opacity: 1;
  }
</style>
</head>
<body>
  <div id="loader">
    <div class="spinner"></div>
    <div class="text">Connecting to Dardcor Code...</div>
  </div>
  <iframe id="frame" src="http://127.0.0.1:25000/dashboard" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
  <script>
    const frame = document.getElementById('frame');
    const loader = document.getElementById('loader');
    
    function checkAndShow() {
      fetch('http://127.0.0.1:25000/api/health')
        .then(r => r.json())
        .then(data => {
          if (data && data.ok) {
            frame.classList.add('loaded');
            loader.style.opacity = '0';
            setTimeout(() => { loader.style.display = 'none'; }, 300);
          } else {
            setTimeout(checkAndShow, 1000);
          }
        })
        .catch(() => {
          setTimeout(checkAndShow, 1000);
        });
    }

    frame.addEventListener('load', () => {
      frame.classList.add('loaded');
      loader.style.opacity = '0';
      setTimeout(() => { loader.style.display = 'none'; }, 300);
    });

    checkAndShow();
  </script>
</body>
</html>`;

		activeDardcorRouterInput = webviewWorkbenchService.openWebview(
			{
				title,
				options: {
					enableFindWidget: false,
					disableServiceWorker: true
				},
				contentOptions: {
					allowScripts: true,
					allowForms: true
				},
				extension: undefined
			},
			'dardcor.router',
			title,
			Codicon.hubot,
			{ group: editorGroupService.activeGroup, preserveFocus: false }
		);
		activeDardcorRouterInput.webview.setHtml(html);
	}
});

export class ChatStatusBarEntry extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chatStatusBarEntry';

	private entry: IStatusbarEntryAccessor | undefined = undefined;

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService
	) {
		super();
		this.update();
	}

	private update(): void {
		const props = this.getEntryProps();
		if (this.entry) {
			this.entry.update(props);
		} else {
			this.entry = this.statusbarService.addEntry(props, 'chat.statusBarEntry', StatusbarAlignment.RIGHT, { location: { id: 'status.editor.mode', priority: 100.1 }, alignment: StatusbarAlignment.RIGHT });
		}
	}

	private getEntryProps(): IStatusbarEntry {
		return {
			name: localize('modelStatus', "Dardcor Code Status"),
			text: '$(hubot) Dardcor Code',
			ariaLabel: localize('modelStatusAria', "Dardcor Code status"),
			command: 'dardcor.model.open',
			showInAllWindows: true
		} satisfies IStatusbarEntry;
	}

	override dispose(): void {
		super.dispose();
		this.entry?.dispose();
		this.entry = undefined;
	}
}
