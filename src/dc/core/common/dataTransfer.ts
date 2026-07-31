export class DataTransferItem { constructor(public value: any) {} }
export class DataTransfer { items = new Map<string, DataTransferItem[]>(); }
