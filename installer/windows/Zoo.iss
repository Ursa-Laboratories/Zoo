#ifndef SourceDir
#define SourceDir "build\stage"
#endif

#ifndef OutputDir
#define OutputDir "dist"
#endif

#ifndef AppVersion
#define AppVersion "0.1.0"
#endif

[Setup]
AppId={{3A7528D5-1BB4-4F1E-B745-62D7419AB0BA}
AppName=Zoo
AppPublisher=Ursa Laboratories
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\UrsaLabs\Zoo
DefaultGroupName=Zoo
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=Zoo-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
WizardStyle=modern
UninstallDisplayName=Zoo

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Dirs]
Name: "{localappdata}\UrsaLabs\Zoo\configs"
Name: "{localappdata}\UrsaLabs\Zoo\logs"

[Files]
Source: "{#SourceDir}\python-installer.exe"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall
Source: "{#SourceDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\wheelhouse\*"; DestDir: "{app}\wheelhouse"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\requirements\*"; DestDir: "{app}\requirements"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\build-info.json"; DestDir: "{app}"; Flags: ignoreversion

[Run]
Filename: "{tmp}\python-installer.exe"; Parameters: "/quiet InstallAllUsers=0 TargetDir=""{app}\Python"" Include_launcher=0 PrependPath=0 Include_test=0 Include_doc=0 Include_tcltk=1 Include_pip=1 SimpleInstall=1"; StatusMsg: "Installing private Python runtime..."; Flags: waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Install-Runtime.ps1"" -InstallDir ""{app}"""; StatusMsg: "Installing Zoo and CubOS runtime packages..."; Flags: waituntilterminated runhidden
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Start-Zoo.ps1"" -InstallDir ""{app}"""; Description: "Start Zoo"; Flags: nowait postinstall skipifsilent unchecked

[Icons]
Name: "{group}\Start Zoo"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Start-Zoo.ps1"" -InstallDir ""{app}"""; WorkingDir: "{app}"
Name: "{group}\Zoo Configs"; Filename: "explorer.exe"; Parameters: """{localappdata}\UrsaLabs\Zoo\configs"""
Name: "{group}\Zoo Logs"; Filename: "explorer.exe"; Parameters: """{localappdata}\UrsaLabs\Zoo\logs"""
Name: "{group}\Export Diagnostics"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Export-Diagnostics.ps1"" -InstallDir ""{app}"""; WorkingDir: "{app}"
Name: "{group}\Uninstall Zoo"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Zoo"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Start-Zoo.ps1"" -InstallDir ""{app}"""; WorkingDir: "{app}"; Tasks: desktopicon
