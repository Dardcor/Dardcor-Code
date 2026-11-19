/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import type { Uri } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { VSBuffer } from '../../../util/dardcor/base/common/buffer';
import { URI } from '../../../util/dardcor/base/common/uri';
import { ConfigKey, IConfigurationService } from '../../configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../extContext/common/extensionContext';
import { IFileSystemService } from '../../filesystem/common/fileSystemService';
import { ILogService } from '../../log/common/logService';

export const IEditLogService = createServiceIdentifier<IEditLogService>('IEditLogService');
export interface IEditLogService {
	_serviceBrand: undefined;

	logEditChatRequest(turnId: string, prompt: ReadonlyArray<Raw.ChatMessage>, response: string): void;

	logSpeculationRequest(turnId: string, uri: Uri, prompt: string, originalContent: string, editedContent: string): void;

	markCompleted(turnId: string, outcome: 'success' | 'error'): Promise<void>;

	getEditLog(turnId: string): Promise<{ prompt: string; response: string }[] | undefined>;
}

interface IEditLogEntry {
	prompt: ReadonlyArray<Raw.ChatMessage>;
	response: string;
	edits: {
		uri: string;
		prompt: string;
		originalContent: string;
		editedContent: string;
	}[];
}

export class EditLogService implements IEditLogService {
	declare readonly _serviceBrand: undefined;

	public readonly LOG_DIR = URI.joinPath(this._vscodeExtensionContext.globalStorageUri, 'editRecordings');

	private readonly _edits = new Map<string, IEditLogEntry>();

	constructor(
		@IVSCodeExtensionContext private readonly _vscodeExtensionContext: IVSCodeExtensionContext,
		@IFileSystemService private readonly _fileSystemService: IFileSystemService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) { }

	private _isEnabled() {
		return this._configurationService.getConfig(ConfigKey.Advanced.EditRecordingEnabled);
	}

	logEditChatRequest(turnId: string, prompt: ReadonlyArray<Raw.ChatMessage>, response: string): void {
		if (!this._isEnabled()) { return; }

		const entry: IEditLogEntry = this._edits.get(turnId) ?? { prompt, response, edits: [] };
		entry.prompt = prompt;
		entry.response = response;
		this._edits.set(turnId, entry);
	}

	logSpeculationRequest(turnId: string, uri: Uri, prompt: string, originalContent: string, editedContent: string): void {
		if (!this._isEnabled()) { return; }

		const entry: IEditLogEntry = this._edits.get(turnId) ?? { prompt: [], response: '', edits: [] };
		entry.edits.push({
			uri: uri.toString(),
			prompt,
			originalContent,
			editedContent,
		});
		this._edits.set(turnId, entry);
	}

	async getEditLog(turnId: string): Promise<{ prompt: string; response: string }[] | undefined> {
		if (!this._isEnabled()) { return; }
		try {
			const data = await this._fileSystemService.readFile(URI.joinPath(this.LOG_DIR, `${turnId}.json`));
			const log = JSON.parse(data.toString()) as IEditLogEntry;
			return log.edits.map((edit) => ({ prompt: edit.prompt, response: edit.editedContent }));
		} catch { }
	}

	async markCompleted(turnId: string, outcome: 'success' | 'error') {
		if (!this._isEnabled()) { return; }

		const edit = this._edits.get(turnId);
		if (!edit) {
			return;
		}
		if (edit.edits.length) {
			const path = URI.joinPath(this.LOG_DIR, `${turnId}.json`);
			this._logService.debug(`Edit recording: ${path.toString()}`);
			await this._fileSystemService.writeFile(path, VSBuffer.fromString(JSON.stringify(edit, undefined, 4)).buffer);
		}
		this._edits.delete(turnId);
	}
}
