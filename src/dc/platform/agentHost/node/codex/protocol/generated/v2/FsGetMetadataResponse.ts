
export type FsGetMetadataResponse = {
	isDirectory: boolean,
	isFile: boolean,
	isSymlink: boolean,
	createdAtMs: number,
	modifiedAtMs: number,
};
