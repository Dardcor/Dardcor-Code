import { spawn } from 'child_process';
import { BrowserWindow } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';

export interface VirtualDesktopInfo {
	supported: boolean;
	desktopId: string | null;
	desktopCount: number;
	windowDesktopId: string | null;
}

export function isVirtualDesktopsSupported(): boolean {
	return process.platform === 'win32' || process.platform === 'darwin';
}

export function getCurrentVirtualDesktopInfo(): Promise<VirtualDesktopInfo> {
	if (process.platform === 'win32') {
		return getWindowsVirtualDesktopInfo();
	}
	if (process.platform === 'darwin') {
		return Promise.resolve({
			supported: true,
			desktopId: null,
			desktopCount: 1,
			windowDesktopId: null
		});
	}
	return Promise.resolve({
		supported: false,
		desktopId: null,
		desktopCount: 1,
		windowDesktopId: null
	});
}

export function getWindowsVirtualDesktopInfo(): Promise<VirtualDesktopInfo> {
	const windowDesktop = getActiveWindowDesktop();
	return Promise.all([getVirtualDesktopCount(), windowDesktop]).then(([count, windowDesktopId]) => ({
		supported: true,
		desktopId: null,
		desktopCount: count,
		windowDesktopId
	}));
}

function getActiveWindowDesktop(): Promise<string | null> {
	return new Promise((resolve) => {
		const script = [
			'$sig = \'[DllImport("user32.dll")] public static extern IntPtr GetWindowDesktopId(IntPtr hwnd);\'',
			'$type = Add-Type -MemberDefinition $sig -Name VirtualDesktop -Namespace Win32 -PassThru',
			'$id = $type::GetWindowDesktopId([IntPtr]::Zero)',
			'if ($id -eq [IntPtr]::Zero) { "null" } else { $id.ToString() }'
		].join('; ');
		const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
			windowsHide: true
		});
		let output = '';
		child.stdout?.on('data', (data: Buffer) => {
			output += data.toString();
		});
		child.on('error', () => resolve(null));
		child.on('close', () => {
			const trimmed = output.trim();
			resolve(trimmed && trimmed !== 'null' && trimmed !== '0' ? trimmed : null);
		});
	});
}

export function getWindowVirtualDesktop(window: BrowserWindow): Promise<string | null> {
	if (process.platform !== 'win32') {
		return Promise.resolve(null);
	}
	const hwnd = getWindowHandle(window);
	if (!hwnd) {
		return Promise.resolve(null);
	}
	return new Promise((resolve) => {
		const script = [
			'$sig = \'[DllImport("user32.dll")] public static extern IntPtr GetWindowDesktopId(IntPtr hwnd);\'',
			'$type = Add-Type -MemberDefinition $sig -Name VirtualDesktop -Namespace Win32 -PassThru',
			'$id = $type::GetWindowDesktopId([IntPtr]' + hwnd + ')',
			'$id.ToString()'
		].join('; ');
		const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
			windowsHide: true
		});
		let output = '';
		child.stdout?.on('data', (data: Buffer) => {
			output += data.toString();
		});
		child.on('error', () => resolve(null));
		child.on('close', () => {
			const trimmed = output.trim();
			resolve(trimmed && trimmed !== '0' ? trimmed : null);
		});
	});
}

export function getVirtualDesktopCount(): Promise<number> {
	if (process.platform !== 'win32') {
		return Promise.resolve(1);
	}
	return new Promise((resolve) => {
		const script = [
			'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
			'$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq \'AsTask\' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq \'IAsyncOperation`1\' })[0]',
			'$asTask = $asTaskGeneric.MakeGenericMethod([Windows.ApplicationModel.Core.CoreApplication, Windows.Foundation, ContentType=WindowsRuntime].GetType())',
			'$await = $asTask.Invoke($null, @($desktopManager))',
			'$desktopManager = [Windows.ApplicationModel.Core.CoreApplication]::CreateNewView()',
			'"count"'
		].join('; ');
		const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
			windowsHide: true
		});
		let output = '';
		child.stdout?.on('data', (data: Buffer) => {
			output += data.toString();
		});
		child.on('error', () => resolve(1));
		child.on('close', () => {
			const value = Number(output.trim());
			resolve(!isNaN(value) && value > 0 ? value : 1);
		});
	});
}

function getWindowHandle(window: BrowserWindow): string | null {
	try {
		const handle = (window as any).getNativeWindowHandle?.();
		if (handle && handle.length >= 4) {
			return handle.readBigInt64LE(0).toString();
		}
	} catch {
		// Ignore.
	}
	return null;
}

export class VirtualDesktopManager extends Disposable {
	constructor() {
		super();
	}

	public async getInfo(): Promise<VirtualDesktopInfo> {
		return getCurrentVirtualDesktopInfo();
	}

	public async getCount(): Promise<number> {
		return getVirtualDesktopCount();
	}

	public async getWindowDesktop(window: BrowserWindow): Promise<string | null> {
		return getWindowVirtualDesktop(window);
	}

	public isSupported(): boolean {
		return isVirtualDesktopsSupported();
	}
}

export function createVirtualDesktopManager(): VirtualDesktopManager {
	return new VirtualDesktopManager();
}
