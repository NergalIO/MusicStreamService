; Assisted installer skips the finish «Run» page in /S, so start the app after a silent install.
; Filename must not be installer.nsh — that would shadow electron-builder's template include.
!macro customInstall
  ${If} ${Silent}
    HideWindow
    !insertmacro StartApp
  ${EndIf}
!macroend
