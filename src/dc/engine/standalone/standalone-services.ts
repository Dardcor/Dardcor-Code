/**
 * Dardcor Code - Standalone DI Service Overrides (Task 260)
 * Mirrors: vs/editor/standalone/browser/standaloneServices.ts
 */

import { InstantiationService, IInstantiationService } from '../../services/instantiation/container';
import { ServiceCollection } from '../../services/instantiation/service-registry';
import { SyncDescriptor } from '../../services/instantiation/descriptors';
import { ThemeService, IThemeService } from '../../services/theme/theme-service';
import { IColorRegistry, getColorRegistry } from '../../services/theme/color-registry';
import { ContextKeyService, IContextKeyService } from '../../services/contextkey/contextkey-service';
import { CommandService, ICommandService } from '../../services/commands/command-service';

export type ServiceOverride = [symbol, unknown];

export interface IStandaloneServices {
	readonly instantiationService: IInstantiationService;
	readonly services: ServiceCollection;
	readonly themeService: IThemeService;
	readonly contextKeyService: IContextKeyService;
	readonly commandService: ICommandService;
}

export class StandaloneServices {
	private static _instance: IStandaloneServices | null = null;

	public static getInstance(): IStandaloneServices {
		if (!this._instance) {
			this._instance = this.createStandaloneServices();
		}
		return this._instance;
	}

	public static createStandaloneServices(overrides: ServiceOverride[] = []): IStandaloneServices {
		const services = new ServiceCollection();

		const colorRegistry = getColorRegistry();
		services.set(IColorRegistry, colorRegistry);
		services.set(IThemeService, new SyncDescriptor(ThemeService, [colorRegistry]));
		services.set(IContextKeyService, new SyncDescriptor(ContextKeyService));
		services.set(ICommandService, new SyncDescriptor(CommandService));

		for (const [id, instance] of overrides) {
			services.set(id as any, instance);
		}

		const instantiationService = new InstantiationService(services);

		return {
			instantiationService,
			services,
			themeService: instantiationService.createInstance(ThemeService, colorRegistry),
			contextKeyService: instantiationService.createInstance(ContextKeyService),
			commandService: instantiationService.createInstance(CommandService, instantiationService),
		};
	}

	public static overrideServices(overrides: ServiceOverride[]): void {
		this._instance = this.createStandaloneServices(overrides);
	}

	public static dispose(): void {
		this._instance = null;
	}
}
