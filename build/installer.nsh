; Windows default-browser requisites.
;
; For an app to be selectable as the default browser in Windows Settings it must
; advertise StartMenuInternet "Capabilities" and a ProgID with an open command.
; We register these per-user (HKCU) so the installer needs no elevation. The
; actual switch is made by the user in Settings (or via the in-app command),
; which is the only supported way on modern Windows.

!macro customInstall
  ; --- ProgID that handles http/https documents -----------------------------
  WriteRegStr HKCU "Software\Classes\MinimalBrowserHTML" "" "Minimal Browser HTML Document"
  WriteRegStr HKCU "Software\Classes\MinimalBrowserHTML\Application" "ApplicationName" "Minimal Browser"
  WriteRegStr HKCU "Software\Classes\MinimalBrowserHTML\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\MinimalBrowserHTML\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; --- StartMenuInternet registration ---------------------------------------
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\MinimalBrowser" "" "Minimal Browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\MinimalBrowser\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\MinimalBrowser\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'

  ; --- Capabilities the Settings "Default apps" UI reads --------------------
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\MinimalBrowser\Capabilities" "ApplicationName" "Minimal Browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\MinimalBrowser\Capabilities" "ApplicationDescription" "A minimalist, keyboard-first browser for developers"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\MinimalBrowser\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\MinimalBrowser\Capabilities\URLAssociations" "http" "MinimalBrowserHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\MinimalBrowser\Capabilities\URLAssociations" "https" "MinimalBrowserHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\MinimalBrowser\Capabilities\StartMenu" "StartMenuInternet" "MinimalBrowser"

  ; --- Advertise the capabilities globally ----------------------------------
  WriteRegStr HKCU "Software\RegisteredApplications" "Minimal Browser" "Software\Clients\StartMenuInternet\MinimalBrowser\Capabilities"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\MinimalBrowserHTML"
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\MinimalBrowser"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Minimal Browser"
!macroend
