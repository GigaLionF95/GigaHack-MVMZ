@echo off
REM ===========================================================================
REM  GigaHack MV/MZ installer - Windows double-click entry point.
REM
REM  This only launches the PowerShell script beside it. -ExecutionPolicy
REM  Bypass applies to this one invocation and changes nothing on the machine;
REM  without it the default policy refuses to run a downloaded .ps1 and the
REM  window closes with no message, which reads as "the installer did nothing".
REM ===========================================================================
setlocal
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%gigahack-install.ps1" %*
echo.
echo Press any key to close this window.
pause >nul
