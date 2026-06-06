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
  DetailPrint "ClawX installer is ready. Existing versions will be removed before installing the new version."
!macroend

!macro customUnInit
  DetailPrint "ClawX uninstaller is ready. You can keep or remove ClawX user data."
!macroend

!macro customInstall
  SetDetailsView show
  DetailPrint "ClawX installation completed."
!macroend

!macro customUnInstall
  SetDetailsView show
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "是否完全卸载 ClawX？$\r$\n$\r$\n选择“是”：删除软件本体、配置、聊天记录、模型密钥、渠道登录态、OpenClaw 运行数据。$\r$\n选择“否”：只删除软件本体，保留数据，重装后继续使用原配置。" \
    IDYES full_uninstall IDNO keep_user_data

  keep_user_data:
    DetailPrint "Keeping ClawX user data."
    Goto uninstall_done

  full_uninstall:
  SetShellVarContext current
  DetailPrint "Removing ClawX user data..."
  RMDir /r "$APPDATA\ClawX"
  RMDir /r "$LOCALAPPDATA\ClawX"
  RMDir /r "$LOCALAPPDATA\clawx-updater"
  RMDir /r "$LOCALAPPDATA\app.clawx.desktop"
  RMDir /r "$PROFILE\.openclaw"
  RMDir /r "$PROFILE\.agents"

  uninstall_done:
  DetailPrint "ClawX uninstallation completed."
!macroend
