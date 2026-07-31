export enum CLIExitCode {
	OK = 0,
	UnknownOption = 1,
	FileNotFound = 2,
	InvalidCommand = 3,
	UserDataDirNotFound = 4,
	Locked = 5,
	ExtensionInstallError = 6,
	GenericError = 7
}
