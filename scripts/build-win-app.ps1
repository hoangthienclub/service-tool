# Script đóng gói Service Monitor thành ứng dụng độc lập trên Windows (.exe & .zip)
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path "$ScriptDir\..").Path
Set-Location $RootDir

$AppName = "Service Monitor"
$ReleaseDir = "$RootDir\release"
$TargetDir = "$ReleaseDir\Service-Monitor-win-x64"
$ZipFile = "$ReleaseDir\Service-Monitor-Windows-x64.zip"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🚀 Đang đóng gói $AppName cho Windows x64..." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Dọn dẹp thư mục build cũ
if (Test-Path $TargetDir) {
    Remove-Item -Recurse -Force $TargetDir
}
if (Test-Path $ZipFile) {
    Remove-Item -Force $ZipFile
}
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

# 2. Sao chép Electron binary x64 từ node_modules
Write-Host "📦 1/4. Sao chép Electron Windows runtime..." -ForegroundColor Yellow
$ElectronDist = "$RootDir\node_modules\electron\dist"
if (-not (Test-Path $ElectronDist)) {
    Write-Error "Không tìm thấy Electron runtime tại $ElectronDist! Vui lòng chạy 'npm install' trước."
}
Copy-Item -Path "$ElectronDist\*" -Destination $TargetDir -Recurse -Force

# Đổi tên electron.exe thành Service Monitor.exe
Rename-Item -Path "$TargetDir\electron.exe" -NewName "$AppName.exe" -Force

# 3. Tạo thư mục resources\app
Write-Host "📂 2/4. Nạp mã nguồn và giao diện..." -ForegroundColor Yellow
$AppResources = "$TargetDir\resources\app"
New-Item -ItemType Directory -Force -Path $AppResources | Out-Null

Copy-Item -Path "$RootDir\package.json" -Destination $AppResources -Force
Copy-Item -Path "$RootDir\main.electron.js" -Destination $AppResources -Force
Copy-Item -Path "$RootDir\server" -Destination $AppResources -Recurse -Force
Copy-Item -Path "$RootDir\dist" -Destination $AppResources -Recurse -Force

# Đảm bảo main trong package.json trỏ tới main.electron.js
$PkgPath = "$AppResources\package.json"
(Get-Content $PkgPath -Raw) -replace '"main":\s*"[^"]*"', '"main": "main.electron.js"' | Set-Content $PkgPath -Encoding UTF8

# Cài đặt production dependencies độc lập
Write-Host "📦 3/4. Đang cài đặt production dependencies độc lập..." -ForegroundColor Yellow
try {
    npm install --omit=dev --no-audit --no-fund --prefix $AppResources
    Write-Host "✅ Đã cài đặt hoàn chỉnh production dependencies." -ForegroundColor Green
} catch {
    Write-Warning "Không thể chạy npm install, sao chép từ node_modules..."
    Copy-Item -Path "$RootDir\node_modules" -Destination $AppResources -Recurse -Force
}

# 4. Tạo file zip đóng gói
Write-Host "📦 4/4. Tạo file nén (.zip)..." -ForegroundColor Yellow
Compress-Archive -Path "$TargetDir\*" -DestinationPath $ZipFile -Force

Write-Host "==========================================" -ForegroundColor Green
Write-Host "✅ ĐÓNG GÓI THÀNH CÔNG!" -ForegroundColor Green
Write-Host "📍 Thư mục ứng dụng: $TargetDir" -ForegroundColor Green
Write-Host "📍 File nén (.zip): $ZipFile" -ForegroundColor Green
Write-Host "👉 Giải nén và nhấp đúp vào '$AppName.exe' là chạy ngay lập tức!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
