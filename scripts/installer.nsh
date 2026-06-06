; ClawX conservative NSIS hooks.
;
; Keep the installer close to electron-builder defaults. Avoid PowerShell,
; Defender exclusions, forced process termination, registry workarounds, and
; custom extraction patches because managed security tools often flag those
; behaviours even when the application payload is benign.

!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
!macroend

!macro customInit
  SetDetailsView show
  DetailPrint "ClawX installer is ready. Existing versions will be removed before installing the new version."
!macroend

!macro customUnInit
  SetDetailsView show
  DetailPrint "ClawX uninstaller is ready. Application files will be removed from the install directory."
!macroend

!macro customInstall
  SetDetailsView show
  DetailPrint "ClawX installation completed."
!macroend

!macro customUnInstall
  SetDetailsView show
  DetailPrint "ClawX uninstallation completed."
!macroend
