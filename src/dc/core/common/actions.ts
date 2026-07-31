export interface IAction { id: string; label: string; tooltip: string; class: string; enabled: boolean; checked: boolean; run(event?: any): Promise<void>; }
export class ActionRunner { async run(action: IAction, context?: any): Promise<void> { await action.run(context); } }
export function toAction(options: any): IAction { return { ...options, run: async () => {} } as IAction; }
