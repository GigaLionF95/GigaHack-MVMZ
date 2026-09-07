@echo off
REM ===========================================================================
REM  GigaHack MV/MZ installer - Windows double-click entry point.
REM
REM  Two things this does beyond launching the PowerShell script:
REM
REM  1. pushd "%~dp0"
REM     cmd.exe cannot set a UNC path as the current directory. On a shared
REM     folder - a Parallels or VMware share of a Mac drive, or any \\server\
REM     path - it prints
REM
REM         CMD.EXE was started with the above path as the current directory.
REM         UNC paths are not supported.  Defaulting to Windows directory.
REM
REM     and drops you in C:\Windows before a single line has run. pushd maps
REM     the share to a temporary drive letter instead, so the working directory
REM     is the folder this script actually lives in. popd releases it.
REM
REM  2. -ExecutionPolicy Bypass
REM     applies to this one invocation and changes nothing on the machine.
REM     Without it the default policy refuses a downloaded .ps1 and the window
REM     closes with no message, which reads as "the installer did nothing".
REM ===========================================================================
setlocal
pushd "%~dp0" 2>nul
if errorlevel 1 (
	echo.
	echo Could not open the folder this installer is in:
	echo   %~dp0
	echo.
	echo If that is a network or shared folder, copy the whole GigaHack folder
	echo to a local drive - the Desktop is fine - and run it from there.
	echo.
	pause
	exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0gigahack-install.ps1" %*
set "RC=%ERRORLEVEL%"

popd
echo.
echo Press any key to close this window.
pause >nul
exit /b %RC%
