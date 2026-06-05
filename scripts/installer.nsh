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

!macro customInstall
  DetailPrint "ClawX installation completed."
!macroend

!macro customUnInstall
  DetailPrint "ClawX uninstallation completed."
!macroend
