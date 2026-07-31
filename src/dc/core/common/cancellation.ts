export interface CancellationToken { readonly isCancellationRequested: boolean; }
export class CancellationTokenSource { token: CancellationToken = { isCancellationRequested: false }; cancel() {} }
export class CancellationError extends Error { constructor() { super('Canceled'); } }
