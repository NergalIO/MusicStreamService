# Hot-reload loop: reinstall debug APK when Kotlin/XML changes.
$ErrorActionPreference = "Stop"
$sdk = "C:\Users\Nergal\AppData\Local\Android\Sdk"
$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_HOME = $sdk
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
Set-Location $PSScriptRoot\..
Write-Host "Watching source, installDebug --continuous"
.\gradlew.bat :app:installDebug --continuous
