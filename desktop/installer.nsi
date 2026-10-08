; ─────────────────────────────────────────────────────────────────────────────
;  BODHA — बोध · Windows installer
;
;  A per-user install: no administrator prompt, no UAC, nothing written outside
;  %LOCALAPPDATA% and the two shortcuts. That is deliberate — BODHA is meant to
;  install on a school computer as easily as on a personal one.
;
;  The payload is a complete BODHA application folder (Electron runtime + the
;  shell in app/), so the installed program has no dependency on the machine
;  beyond Windows 10 or 11 itself. Every file is copied to $INSTDIR; the only
;  registry keys written are the uninstall entry, the install path, and App
;  Paths so "BODHA" works from Run.
;
;  Built with makensis on Linux; see build-desktop.sh.
; ─────────────────────────────────────────────────────────────────────────────

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!ifndef PAYLOAD
  !define PAYLOAD "build/payload"
!endif
!ifndef OUTFILE
  !define OUTFILE "build/BODHA-Setup-1.0.exe"
!endif

!define APP_NAME "BODHA"
!define APP_MARK "बोध"
!define APP_VERSION "1.0.0"
!define APP_PUBLISHER "Srijan Singh and Parv Mishra"
!define APP_URL "https://bodha-ai-three.vercel.app"
!define APP_REPO "https://github.com/srijan7815-bit/bodha-ai"
!define APP_KEY "Software\BODHA"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\BODHA"

Name "${APP_NAME}"
BrandingText "${APP_NAME} · ${APP_MARK} · ${APP_VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\BODHA"
InstallDirRegKey HKCU "${APP_KEY}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP_NAME} ${APP_MARK} — installer"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "Created by ${APP_PUBLISHER}"

!define MUI_ICON "icons/bodha.ico"
!define MUI_UNICON "icons/bodha.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "icons/header.bmp"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APP_NAME} · ${APP_MARK}"
!define MUI_WELCOMEPAGE_TEXT "An evidence-grounded research copilot for Indian Knowledge Systems.$\r$\n$\r$\nBODHA answers from sources you can open and read — the Indian Knowledge Systems library, your own documents, the web, and BODHA's own computer. Created by Srijan Singh and Parv Mishra, NCSC 2026-27.$\r$\n$\r$\nThis installs BODHA on this PC as a normal Windows program: a Start Menu entry, an optional desktop shortcut, and an uninstaller in Settings › Apps. About 300 MB is needed, and the app keeps itself up to date with the web app — there is nothing to update by hand."
!define MUI_FINISHPAGE_TITLE "BODHA is installed"
!define MUI_FINISHPAGE_TEXT "BODHA opens in its own window. Sign in with the same account you use on your phone, and your chats, documents and library are already there.$\r$\n$\r$\nThe reasoning, the sources and the documents are produced on the server, so BODHA needs a working internet connection — that is the whole point of the design."
!define MUI_FINISHPAGE_RUN "$INSTDIR\BODHA.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open BODHA now"
!define MUI_FINISHPAGE_LINK "BODHA on GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION "${APP_REPO}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ───────────────────────────── components ─────────────────────────────

LangString DESC_App ${LANG_ENGLISH} "BODHA itself, in its own folder under your user account. No administrator rights and nothing shared with other users."
LangString DESC_Shortcuts ${LANG_ENGLISH} "A shortcut on the Start Menu, and on the Desktop if you want one."

Section "BODHA (required)" SEC_APP
  SectionIn RO
  SetShellVarContext current
  SetOutPath "$INSTDIR"

  ; An installed copy that is still running would lock its own files.
  DetailPrint "Closing any copy of BODHA that is still running…"
  nsExec::ExecToLog 'taskkill /IM BODHA.exe /F'
  Pop $0

  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall BODHA.exe"

  WriteRegStr HKCU "${APP_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${APP_KEY}" "Version" "${APP_VERSION}"

  ; Settings › Apps › BODHA
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME} · ${APP_MARK}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\BODHA.exe,0"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall BODHA.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall BODHA.exe" /S'
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "${APP_URL}"
  WriteRegStr HKCU "${UNINST_KEY}" "HelpLink" "${APP_REPO}"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"

  ; So "BODHA" works from Run, and from a browser's "open with" list.
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\BODHA.exe" "" "$INSTDIR\BODHA.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\BODHA.exe" "Path" "$INSTDIR"
SectionEnd

Section "Shortcuts" SEC_SHORTCUTS
  SetShellVarContext current
  CreateDirectory "$SMPROGRAMS\BODHA"
  CreateShortcut "$SMPROGRAMS\BODHA\BODHA.lnk" "$INSTDIR\BODHA.exe" "" "$INSTDIR\BODHA.exe" 0
  CreateShortcut "$SMPROGRAMS\BODHA\Uninstall BODHA.lnk" "$INSTDIR\Uninstall BODHA.exe"
  CreateShortcut "$DESKTOP\BODHA.lnk" "$INSTDIR\BODHA.exe" "" "$INSTDIR\BODHA.exe" 0
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_APP} $(DESC_App)
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_SHORTCUTS} $(DESC_Shortcuts)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ────────────────────────────── uninstall ─────────────────────────────

Section "Uninstall"
  SetShellVarContext current
  nsExec::ExecToLog 'taskkill /IM BODHA.exe /F'
  Pop $0

  Delete "$DESKTOP\BODHA.lnk"
  Delete "$SMPROGRAMS\BODHA\BODHA.lnk"
  Delete "$SMPROGRAMS\BODHA\Uninstall BODHA.lnk"
  RMDir "$SMPROGRAMS\BODHA"

  RMDir /r "$INSTDIR"

  ; Chats and documents live on the server, so the only local state is the
  ; window's size and position — removed with the program, as Windows expects.
  RMDir /r "$APPDATA\BODHA"
  RMDir /r "$LOCALAPPDATA\BODHA"

  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "${APP_KEY}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\BODHA.exe"
SectionEnd
