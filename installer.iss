[Setup]
AppName=Dardcor Code
AppVersion=1.0.0
AppPublisher=Dardcor Team
AppPublisherURL=https://github.com/Dardcor/Dardcor-Code
AppSupportURL=https://github.com/Dardcor/Dardcor-Code/issues
AppUpdatesURL=https://github.com/Dardcor/Dardcor-Code/releases
VersionInfoVersion=1.0.0.0
VersionInfoCompany=Dardcor Team
VersionInfoDescription=Dardcor Code Setup
VersionInfoProductName=Dardcor Code
VersionInfoProductVersion=1.0.0.0
DefaultDirName={autopf}\Dardcor Code
DefaultGroupName=Dardcor Code
UninstallDisplayIcon={app}\Dardcor Code.exe
SetupIconFile=image\dardcor.ico
Compression=lzma2
SolidCompression=yes
OutputDir=dist
OutputBaseFilename=Dardcor-Code-Setup-Windows
ArchitecturesInstallIn64BitMode=x64

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "dist\Dardcor Code\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Dardcor Code"; Filename: "{app}\Dardcor Code.exe"
Name: "{autodesktop}\Dardcor Code"; Filename: "{app}\Dardcor Code.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Dardcor Code.exe"; Description: "{cm:LaunchProgram,Dardcor Code}"; Flags: nowait postinstall skipifsilent
