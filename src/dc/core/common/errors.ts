export class ErrorNoTelemetry extends Error {}
export function canceled() { return new Error('Canceled'); }
export class IllegalArgumentError extends Error {}
export function transformErrorForSerialization(err: any) { return err; }
export function isErrorWithActions(err: any) { return false; }
