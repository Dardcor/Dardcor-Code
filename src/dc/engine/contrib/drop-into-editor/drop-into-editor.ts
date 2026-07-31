/**
 * Dardcor Code - File Drag & Drop Content Parser
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, addDisposableListener } from "../../../core/dom/element.js";
import { ITextModel, IPosition } from "../../model/text-model.js";

export interface IDroppedContent {
	readonly text: string;
	readonly fileNames: string[];
	readonly position: IPosition | null;
}

export interface IDropIntoEditorHost {
	getContainer(): HTMLElement;
	getModel(): ITextModel | null;
	getPositionFromEvent(event: DragEvent): IPosition | null;
	insertText(text: string): void;
	openFile?(fileName: string): void;
}

const TEXT_MIME = "text/plain";
const HTML_MIME = "text/html";
const URI_LIST_MIME = "text/uri-list";

export class DropIntoEditor extends Disposable {
	private readonly _host: IDropIntoEditorHost;
	private readonly _dropOverlay: HTMLElement;
	private _dropCounter: number = 0;

	private readonly _onDidDrop = this._register(new Emitter<IDroppedContent>());
	readonly onDidDrop: Event<IDroppedContent> = this._onDidDrop.event;

	constructor(host: IDropIntoEditorHost) {
		super();
		this._host = host;
		const container = host.getContainer();

		this._dropOverlay = $<HTMLElement>("div", "dc-drop-overlay");
		this._dropOverlay.textContent = "Drop to insert";
		this._dropOverlay.style.cssText = "position:absolute;inset:0;z-index:80;display:none;align-items:center;justify-content:center;background:rgba(14,99,156,0.25);border:2px dashed #3794ff;color:#d4d4d4;font-family:Segoe UI, sans-serif;font-size:15px;pointer-events:none;";
		container.appendChild(this._dropOverlay);

		this._register(addDisposableListener(container, "dragover", e => {
			e.preventDefault();
			(e as DragEvent).dataTransfer!.dropEffect = "copy";
		}));
		this._register(addDisposableListener(container, "dragenter", e => {
			e.preventDefault();
			this._dropCounter++;
			this._dropOverlay.style.display = "flex";
		}));
		this._register(addDisposableListener(container, "dragleave", () => {
			this._dropCounter--;
			if (this._dropCounter <= 0) {
				this._dropCounter = 0;
				this._dropOverlay.style.display = "none";
			}
		}));
		this._register(addDisposableListener(container, "drop", e => {
			e.preventDefault();
			this._dropCounter = 0;
			this._dropOverlay.style.display = "none";
			this._handleDrop(e as DragEvent);
		}));
	}

	private async _handleDrop(event: DragEvent): Promise<void> {
		const dt = event.dataTransfer;
		if (!dt) {
			return;
		}
		const position = this._host.getPositionFromEvent(event);
		const fileNames: string[] = [];
		let text = "";

		if (dt.files && dt.files.length > 0) {
			const contents: string[] = [];
			for (const file of Array.from(dt.files)) {
				fileNames.push(file.name);
				try {
					if (file.type.startsWith("text/") || file.name.match(/\.(?:txt|md|json|ts|js|tsx|jsx|css|html|xml|yml|yaml|py|java|c|cpp|h|cs|go|rs|sh|bat|sql|log)$/i)) {
						const content = await file.text();
						if (content.length > 0) {
							contents.push(`// ${file.name}\n${content}`);
						}
					}
				} catch {
					// Unreadable file: keep going
				}
			}
			text = contents.join("\n");
		} else {
			text = dt.getData(URI_LIST_MIME) || dt.getData(TEXT_MIME) || dt.getData(HTML_MIME);
			const uris = dt.getData(URI_LIST_MIME).split(/\r?\n/).filter(u => u.length > 0 && !u.startsWith("#"));
			fileNames.push(...uris);
			if (fileNames.length > 0) {
				text = fileNames.map(name => `// ${name}`).join("\n");
			}
			if (dt.types.includes(HTML_MIME) && !text) {
				text = this._extractTextFromHtml(dt.getData(HTML_MIME));
			}
		}

		if (text.length === 0) {
			return;
		}
		this._host.insertText(text);
		this._onDidDrop.fire({ text, fileNames, position });
	}

	private _extractTextFromHtml(html: string): string {
		const template = document.createElement("template");
		template.innerHTML = html;
		return template.content.textContent ?? "";
	}

	public override dispose(): void {
		this._dropOverlay.remove();
		super.dispose();
	}
}
