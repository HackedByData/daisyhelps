!macro customInstall
  ; Reserved for future install-time customization (file associations, etc.)
!macroend

!macro customUnInstall
  ; Remove any user-data caches we may write in future versions
  RMDir /r "$APPDATA\DaisyHelps\Cache"
!macroend
