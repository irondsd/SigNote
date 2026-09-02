# Windows URL-protocol registration for signote://auth/callback.
#
# electron-builder only writes protocol declarations for macOS bundles and
# Linux desktop entries, so the NSIS installer has to create the registry keys
# itself. Electron also calls app.setAsDefaultProtocolClient at runtime, but
# registering during installation means a cold-start deep link resolves before
# the application has ever been launched.
#
# SHCTX is HKLM for a per-machine install and HKCU for a per-user install, so
# the same key path serves both installation modes.

!macro customInstall
  DetailPrint "Registering signote:// protocol handler"
  WriteRegStr SHCTX "Software\Classes\signote" "" "URL:SigNote Protocol"
  WriteRegStr SHCTX "Software\Classes\signote" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\signote\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\signote\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DetailPrint "Removing signote:// protocol handler"
  DeleteRegKey SHCTX "Software\Classes\signote"
!macroend
