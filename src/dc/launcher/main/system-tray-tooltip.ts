import { Tray } from 'electron';

const DEFAULT_TOOLTIP = 'Dardcor Code';

export function setTrayTooltip(tray: Tray, tooltip: string): void {
	try {
		tray.setToolTip(tooltip);
	} catch (err) {
		console.warn('[system-tray-tooltip] setToolTip failed:', err);
	}
}

export function getTrayTooltip(tray: Tray): string {
	try {
		return (tray as any).getToolTip?.() ?? "";
	} catch {
		return DEFAULT_TOOLTIP;
	}
}

export function getStatusTooltip(status: string): string {
	if (!status) {
		return DEFAULT_TOOLTIP;
	}
	return `${DEFAULT_TOOLTIP} - ${status}`;
}

export function getReadyTooltip(): string {
	return getStatusTooltip('Ready');
}

export function getBusyTooltip(operation?: string): string {
	return getStatusTooltip(operation ? `Working: ${operation}` : 'Working');
}

export function getErrorTooltip(message?: string): string {
	return getStatusTooltip(message ? `Error: ${message}` : 'Error');
}

export function updateTrayTooltipWithStatus(tray: Tray, status: string): void {
	setTrayTooltip(tray, getStatusTooltip(status));
}

export function setTrayTooltipReady(tray: Tray): void {
	setTrayTooltip(tray, getReadyTooltip());
}

export function setTrayTooltipBusy(tray: Tray, operation?: string): void {
	setTrayTooltip(tray, getBusyTooltip(operation));
}

export function getDefaultTooltip(): string {
	return DEFAULT_TOOLTIP;
}

export class TrayTooltip {
	private _current: string;

	constructor(private readonly _tray: Tray, initialTooltip: string = DEFAULT_TOOLTIP) {
		this._current = initialTooltip;
		setTrayTooltip(this._tray, initialTooltip);
	}

	public set(tooltip: string): void {
		this._current = tooltip;
		setTrayTooltip(this._tray, tooltip);
	}

	public setStatus(status: string): void {
		this.set(getStatusTooltip(status));
	}

	public get(): string {
		return this._current;
	}

	public reset(): void {
		this.set(DEFAULT_TOOLTIP);
	}
}

export function createTrayTooltip(tray: Tray, initialTooltip?: string): TrayTooltip {
	return new TrayTooltip(tray, initialTooltip);
}
