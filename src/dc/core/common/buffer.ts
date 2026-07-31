export class VSBuffer { static alloc(size: number) { return new VSBuffer(); } }
export interface VSBufferReadable { read(): VSBuffer | null; }
export interface VSBufferWriteable { write(buffer: VSBuffer): void; }
