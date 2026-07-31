import { app } from 'electron';

let gpuDisabled = false;

export interface GpuStatus {
	enabled: boolean;
	featureStatus: Record<string, string> | null;
	commandLineFlags: string[];
}

export function isGpuAccelerationEnabled(): boolean {
	if (gpuDisabled) {
		return false;
	}
	if (app.commandLine.hasSwitch('disable-gpu')) {
		return false;
	}
	if (app.commandLine.hasSwitch('disable-gpu-compositing')) {
		return false;
	}
	if (app.commandLine.hasSwitch('disable-software-rasterizer')) {
		return false;
	}
	return true;
}

export function setGpuAcceleration(enabled: boolean): void {
	if (enabled) {
		app.commandLine.removeSwitch('disable-gpu');
		app.commandLine.removeSwitch('disable-gpu-compositing');
		app.commandLine.removeSwitch('disable-software-rasterizer');
		gpuDisabled = false;
		return;
	}
	try {
		app.disableHardwareAcceleration();
	} catch (err) {
		console.warn('[gpu-acceleration] disableHardwareAcceleration failed:', err);
	}
	app.commandLine.appendSwitch('disable-gpu');
	app.commandLine.appendSwitch('disable-gpu-compositing');
	app.commandLine.appendSwitch('disable-software-rasterizer');
	gpuDisabled = true;
}

export function disableGpuAcceleration(): void {
	setGpuAcceleration(false);
}

export function enableGpuAcceleration(): void {
	setGpuAcceleration(true);
}

export function getGpuStatus(): GpuStatus {
	let featureStatus: Record<string, string> | null = null;
	try {
		if (app.isReady()) {
			const status = app.getGPUFeatureStatus();
			featureStatus = Object.keys(status).reduce<Record<string, string>>((acc, key) => {
				acc[key] = (status as any)[key];
				return acc;
			}, {});
		}
	} catch {
		featureStatus = null;
	}
	return {
		enabled: isGpuAccelerationEnabled(),
		featureStatus,
		commandLineFlags: [
			...app.commandLine.getSwitchValue('js-flags') ? ['--js-flags'] : [],
			...app.commandLine.hasSwitch('disable-gpu') ? ['--disable-gpu'] : [],
			...app.commandLine.hasSwitch('disable-gpu-compositing') ? ['--disable-gpu-compositing'] : []
		]
	};
}

export function isGpuCompositingEnabled(): boolean {
	try {
		if (!app.isReady()) {
			return true;
		}
		const status = app.getGPUFeatureStatus();
		return status.gpu_compositing !== 'disabled';
	} catch {
		return true;
	}
}

export function getGpuFeature(feature: string): string | null {
	try {
		if (!app.isReady()) {
			return null;
		}
		const status = app.getGPUFeatureStatus();
		return (status as any)[feature] ?? null;
	} catch {
		return null;
	}
}

export function isSoftwareRasterizerEnabled(): boolean {
	return !app.commandLine.hasSwitch('disable-software-rasterizer');
}

export function getGpuAccelerationSummary(): string {
	const status = getGpuStatus();
	const parts: string[] = [];
	parts.push(`Hardware acceleration: ${status.enabled ? 'Enabled' : 'Disabled'}`);
	if (status.featureStatus) {
		for (const [key, value] of Object.entries(status.featureStatus)) {
			parts.push(`  ${key}: ${value}`);
		}
	}
	return parts.join('\n');
}
