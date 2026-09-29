$ErrorActionPreference = "Continue"
$sdk = "C:\Users\Nergal\AppData\Local\Android\Sdk"
$adb = Join-Path $sdk "platform-tools\adb.exe"
$out = "C:\Users\Nergal\Desktop\MusicStreamService\apps\android\build\ui-verify"
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Shot([string]$name) {
  Start-Sleep -Milliseconds 1000
  & $adb shell screencap -p /sdcard/mss.png | Out-Null
  & $adb pull /sdcard/mss.png "$out\$name.png" | Out-Null
  Write-Host "saved $name"
}

function OpenApp {
  & $adb shell am start -n com.mss.android/.MainActivity | Out-Null
  Start-Sleep -Seconds 1
}

function Link([string]$url) {
  & $adb shell am start -a android.intent.action.VIEW -d $url -n com.mss.android/.MainActivity | Out-Null
  Start-Sleep -Seconds 1
}

function GetSize {
  $physW = 1080; $physH = 2400
  $overW = 0; $overH = 0
  foreach ($line in @(& $adb shell wm size)) {
    if ($line -match "Physical size:\s*(\d+)x(\d+)") { $physW = [int]$Matches[1]; $physH = [int]$Matches[2] }
    if ($line -match "Override size:\s*(\d+)x(\d+)") { $overW = [int]$Matches[1]; $overH = [int]$Matches[2] }
  }
  if ($overW -gt 0) { return @{ w = $overW; h = $overH } }
  return @{ w = $physW; h = $physH }
}

function TapFrac([double]$fx, [double]$fy) {
  $s = GetSize
  $x = [int]($s.w * $fx)
  $y = [int]($s.h * $fy)
  Write-Host ("tap {0},{1} of {2}x{3}" -f $x, $y, $s.w, $s.h)
  & $adb shell input tap $x $y
}

& $adb shell wm size reset
& $adb shell wm density reset
Start-Sleep -Seconds 1
& $adb logcat -c
& $adb shell input keyevent KEYCODE_HOME
Start-Sleep -Milliseconds 400
& $adb shell am force-stop com.mss.android
Start-Sleep -Milliseconds 500
OpenApp
Start-Sleep -Seconds 2
Shot "70_start_1080"

TapFrac 0.5 0.78
Start-Sleep -Seconds 2
Shot "71_home_1080"
Link "mss://search"
Shot "72_search_1080"
Link "mss://settings"
Shot "73_settings_1080"
Link "mss://wave"
Shot "74_wave_1080"
Link "mss://open"

& $adb shell wm size 720x1280
Start-Sleep -Seconds 2
OpenApp
Shot "75_home_compact"
Link "mss://search"
Shot "76_search_compact"
Link "mss://settings"
Shot "77_settings_compact"
Link "mss://open"
TapFrac 0.5 0.62
Start-Sleep -Seconds 3
Shot "78_play_compact"

& $adb shell wm size 2400x1080
Start-Sleep -Seconds 2
OpenApp
Shot "79_land"
Link "mss://wave"
Shot "80_wave_land"

& $adb shell wm size 1080x1920
Start-Sleep -Seconds 2
OpenApp
Shot "81_mid"

& $adb shell wm size reset
Start-Sleep -Seconds 1
OpenApp
Shot "82_reset"
Write-Host "FOCUS"
& $adb shell dumpsys window | Select-String "mCurrentFocus"
Write-Host "FATAL"
& $adb logcat -d | findstr /C:"FATAL EXCEPTION"
Write-Host "done"
