@echo off
rem Crea los accesos directos de Kairus Journal en el Inicio de Windows y en el Escritorio.
set "APP=%~dp0kairus_journal.pyw"
set "PYW="
for /f "delims=" %%p in ('where pythonw 2^>nul') do if not defined PYW set "PYW=%%p"
if not defined PYW (
  echo No encontre pythonw.exe. Revisa que Python este instalado con "Add python.exe to PATH".
  pause
  exit /b 1
)
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; foreach($d in @([Environment]::GetFolderPath('Startup'),[Environment]::GetFolderPath('Desktop'))){ $s=$w.CreateShortcut($d+'\Kairus Journal.lnk'); $s.TargetPath='%PYW%'; $s.Arguments='\"%APP%\"'; $s.WorkingDirectory='%~dp0'; $s.Save() }"
echo Listo: Kairus Journal se abrira solo cuando el VPS se reinicie, y tienes un icono en el Escritorio.
pause
