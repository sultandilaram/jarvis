# Windows 11 x64

Windows support is under development. A cross-compiled archive is a build
candidate, not a verified tester release. Native control and offline wake-word
acceptance are required before a Windows artifact enters `deliverables`.

The app runs as an ordinary user. Native UI Automation can inspect accessible
application controls, replace ordinary leaf text fields and invoke controls after
review. Protected, elevated, credential and assistant windows are excluded.
Text controls with children are refused before approval, preventing replacement
of a protected descendant through an otherwise ordinary parent control.
Some applications expose incomplete controls; JARVIS refuses incomplete targets.
Use the embedded browser for web interaction. External browser control and visual
pointer fallback are not supported on Windows in this version.

Wake listening is off on a fresh installation. Enable it in Settings; Windows must
allow desktop microphone access. Idle audio is processed locally by bundled Vosk
and the offline English model, without opening an API session or recording files.
Recognized wake phrases start your configured voice conversation; that active
conversation may use a billed provider. Stop ends the active task/voice session.

Install Codex for Windows and sign in separately. Discovery prefers an explicit
`JARVIS_CODEX_PATH`, then native PATH/npm installations, then the desktop app's
`%LOCALAPPDATA%\OpenAI\Codex\bin\<runtime-hash>\codex.exe` cache. It chooses the
newest modified valid executable in that bounded cache on each startup, without
persisting the version hash. Linked directories/files and network/device roots
are excluded from automatic cache discovery. If discovery fails, set
`JARVIS_CODEX_PATH` to the installed native executable's absolute path before
starting JARVIS. Command wrappers and scripts are not launched. Other configured providers
can be used without Codex. Each tester supplies their own credentials.
Credentials use Windows operating-system encryption; Mac secrets are never copied.

Project jobs, repository self-modification and privileged release builds remain
disabled until Windows OS confinement is implemented. No unconfined command
fallback exists. Windows automatic updates are not yet implemented; a Mac update
archive is never offered to Windows. Login startup uses the current executable
path, so retain the extracted folder in one stable location.

## Build and verify

Use Node 24+, Python 3, and .NET SDK 10.0.404. From a clean source checkout:

```
npm ci
npm run typecheck
npm run native:windows
python scripts/windows/setup-model.py
dotnet publish tests/windows/NativeControlFixture.csproj -c Release -o .jarvis/windows-fixture
npm run test:windows-native
npm run package:windows
```

The native runtime tests require an actual Windows interactive desktop. They
exercise a separate inert WPF app, stale-input rejection, sensitive-field redaction
and positive/negative offline audio fixtures. They do not prove physical microphone,
speaker, wake-to-voice, correction, Stop or approval behavior. Those require a
Windows tester before release. Keep Windows security protections enabled; never
bypass a harmful-app warning to run a candidate.
