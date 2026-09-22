# Superpowers Finish - Fix Windows Build Script Parser Error

## Summary of Completed Work
1. **Identified Root Cause**:
   - `scripts/build-win-app.ps1` had multi-byte Unicode emoji characters (`📦`, `📂`, `📍`, `👉`, `✅`) without a UTF-8 BOM.
   - On Windows runners (`windows-latest`), Windows PowerShell 5.1 reads files without BOM using system default ANSI (Windows-1252).
   - In UTF-8, characters like `📍` (`0xF0 0x9F 0x93 0x8D`) and `📦` contain byte `0x93`, which Windows-1252 maps to `“` (left curly double quote).
   - PowerShell 5.1 recognizes curly quotes as string delimiters, corrupting string boundaries and throwing `TerminatorExpectedAtEndOfString: The string is missing the terminator: "` at line 70.
   - Furthermore, `'$AppName.exe'` inside double quotes was unsafe.

2. **Implemented Fix**:
   - Replaced multi-byte emojis with clean ASCII banners (`[1/4]`, `[SUCCESS]`, `[INFO]`).
   - Fixed variable interpolation syntax to `"$($AppName).exe"`.
   - Saved `scripts/build-win-app.ps1` with standard UTF-8 BOM (`\xef\xbb\xbf`).
   - Updated `.github/workflows/release.yml` release file match to `**/*.zip` to ensure both macOS and Windows artifacts are picked up regardless of download directory nesting.

3. **Verification**:
   - Verified UTF-8 BOM header (`efbb bf23...`).
   - Tested quote balancing and verified zero unclosed quotes.
   - Tested character set to ensure zero encoding-dependent byte collisions.
