#define MyAppName "AtikMeet"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Atik Shahriar"
#define MyAppExeName "AtikMeet.exe"

[Setup]
AppId={{D3F9B8EC-53B4-4B2E-BE60-B145191247E6}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
LicenseFile=e:\google meet\license.txt
OutputDir=e:\google meet\out
OutputBaseFilename=AtikMeet-1.0.0-Wizard-Setup
SetupIconFile=e:\google meet\assets\icon.ico
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "e:\google meet\out\AtikMeet-win32-x64\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
