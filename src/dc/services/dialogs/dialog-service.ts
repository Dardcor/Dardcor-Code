/**
 * Dardcor Code - Dialog Service (Task 127)
 * Mirrors: vs/platform/dialogs/common/dialogs.ts
 */

import { IDisposable } from '../../core/lifecycle/disposable.js';
import { Severity } from '../notification/notification-service.js';

export interface IConfirmation {
	title?: string;
	message: string;
	detail?: string;
	primaryButton?: string;
	secondaryButton?: string;
	cancelButton?: string;
	severity?: Severity;
}

export interface IConfirmationResult {
	confirmed: boolean;
	checkboxChecked?: boolean;
}

export const IDialogService = Symbol('IDialogService');

export interface IDialogService {
	confirm(confirmation: IConfirmation): Promise<IConfirmationResult>;
	info(message: string, detail?: string): Promise<void>;
	warn(message: string, detail?: string): Promise<void>;
	error(message: string, detail?: string): Promise<void>;
}

export class BrowserDialogService implements IDialogService {
	async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		const res = window.confirm(`${confirmation.title ? confirmation.title + '\n\n' : ''}${confirmation.message}\n\n${confirmation.detail ?? ''}`);
		return { confirmed: res };
	}

	async info(message: string, detail?: string): Promise<void> {
		window.alert(`[INFO] ${message}\n\n${detail ?? ''}`);
	}

	async warn(message: string, detail?: string): Promise<void> {
		window.alert(`[WARNING] ${message}\n\n${detail ?? ''}`);
	}

	async error(message: string, detail?: string): Promise<void> {
		window.alert(`[ERROR] ${message}\n\n${detail ?? ''}`);
	}
}
