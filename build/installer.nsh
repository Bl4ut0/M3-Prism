!macro customInstall
  IfFileExists "$INSTDIR\webplayer.config.json" done

  FileOpen $0 "$INSTDIR\webplayer.config.json" w
  FileWrite $0 "{$\r$\n"
  FileWrite $0 "  $\"tmdbApiKey$\": $\"$\",$\r$\n"
  FileWrite $0 "  $\"userAgent$\": $\"WebPlayer/2.0$\",$\r$\n"
  FileWrite $0 "  $\"language$\": $\"en-US$\",$\r$\n"
  FileWrite $0 "  $\"includeAdult$\": false$\r$\n"
  FileWrite $0 "}$\r$\n"
  FileClose $0

done:
!macroend
