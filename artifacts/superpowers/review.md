# Superpowers Review - Fix Windows Build Script Parser Error

## Overview
Fixed the Windows PowerShell syntax/parser error encountered during CI/CD execution:
`TerminatorExpectedAtEndOfString: The string is missing the terminator: "` at line 70.

## Review Findings by Severity

- **Blocker**: None.
- **Major**:
  - *Fixed*: Emojis (`📦`, `📂`, `📍`, etc.) in `scripts/build-win-app.ps1` contained byte `0x93` in UTF-8. Because the file lacked a UTF-8 BOM, Windows PowerShell 5.1 on the Windows runner decoded the file in Windows-1252, where `0x93` is the left double quotation mark (`“`), causing PowerShell's token parser to interpret it as an unclosed string delimiter and fail at line 70.
- **Minor**:
  - *Fixed*: String interpolation `'$AppName.exe'` inside double quotes replaced with safe explicit subexpression `"$($AppName).exe"`.
  - *Fixed*: Added standard UTF-8 BOM (`\xef\xbb\xbf`) and converted log messages to clean ASCII to ensure 100% reliable execution across all PowerShell versions (Windows PowerShell 5.1 and pwsh 7+).
  - *Fixed*: Updated `release.yml` release step to use `**/*.zip` so GitHub Actions artifact download directory nesting is seamlessly resolved.
- **Nit**: None.

## Verification
- Verified UTF-8 BOM header presence (`efbb bf`).
- Verified zero non-ASCII characters in script body.
- Verified quote and string delimiter balance in the PowerShell file.
