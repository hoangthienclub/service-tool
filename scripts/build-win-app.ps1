# Script to package Service Monitor as a standalone Windows application (.exe & .zip)
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path "$ScriptDir\..").Path
Set-Location $RootDir

$AppName = "Service Monitor"
$ReleaseDir = "$RootDir\release"
$TargetDir = "$ReleaseDir\Service-Monitor-win-x64"
$ZipFile = "$ReleaseDir\Service-Monitor-Windows-x64.zip"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Packaging $($AppName) for Windows x64..." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Clean previous build directory
if (Test-Path $TargetDir) {
    Remove-Item -Recurse -Force $TargetDir
}
if (Test-Path $ZipFile) {
    Remove-Item -Force $ZipFile
}
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

# 2. Copy Electron binary x64 from node_modules
Write-Host "[1/4] Copying Electron Windows runtime..." -ForegroundColor Yellow
$ElectronDist = "$RootDir\node_modules\electron\dist"
if (-not (Test-Path $ElectronDist)) {
    Write-Error "Could not find Electron runtime at $ElectronDist! Please run 'npm install' first."
}
Copy-Item -Path "$ElectronDist\*" -Destination $TargetDir -Recurse -Force

# Rename electron.exe to Service Monitor.exe
Rename-Item -Path "$TargetDir\electron.exe" -NewName "$($AppName).exe" -Force

# 3. Create resources\app
Write-Host "[2/4] Copying app source and bundle..." -ForegroundColor Yellow
$AppResources = "$TargetDir\resources\app"
New-Item -ItemType Directory -Force -Path $AppResources | Out-Null

Copy-Item -Path "$RootDir\package.json" -Destination $AppResources -Force
Copy-Item -Path "$RootDir\main.electron.js" -Destination $AppResources -Force
Copy-Item -Path "$RootDir\server" -Destination $AppResources -Recurse -Force
Copy-Item -Path "$RootDir\dist" -Destination $AppResources -Recurse -Force

# Ensure main in package.json points to main.electron.js
$PkgPath = "$AppResources\package.json"
(Get-Content $PkgPath -Raw) -replace '"main":\s*"[^"]*"', '"main": "main.electron.js"' | Set-Content $PkgPath -Encoding UTF8

# Install production dependencies
Write-Host "[3/4] Installing standalone production dependencies..." -ForegroundColor Yellow
try {
    npm install --omit=dev --no-audit --no-fund --prefix $AppResources
    Write-Host "[SUCCESS] Installed production dependencies." -ForegroundColor Green
} catch {
    Write-Warning "npm install failed, falling back to copying node_modules..."
    Copy-Item -Path "$RootDir\node_modules" -Destination $AppResources -Recurse -Force
}

# 4. Create zip package
Write-Host "[4/4] Creating zip package..." -ForegroundColor Yellow
Compress-Archive -Path "$TargetDir\*" -DestinationPath $ZipFile -Force

Write-Host "==========================================" -ForegroundColor Green
Write-Host "[SUCCESS] PACKAGING COMPLETED!" -ForegroundColor Green
Write-Host "App directory: $TargetDir" -ForegroundColor Green
Write-Host "Zip package:   $ZipFile" -ForegroundColor Green
Write-Host "Extract and launch '$($AppName).exe' to run." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
