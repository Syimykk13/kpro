param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$Version = "1.1.15"
$ServerUrl = "http://132.243.114.107:5173"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ReleaseRoot = Join-Path $ProjectRoot "release"
$PackageDir = Join-Path $ReleaseRoot "K-pro-Setup-$Version"
$AppFilesDir = Join-Path $PackageDir "app"
$AppZip = Join-Path $PackageDir "app.zip"
$SetupExe = Join-Path $ReleaseRoot "K-pro-Setup-$Version.exe"
$SetupZip = Join-Path $ReleaseRoot "K-pro-Setup-$Version.zip"
$BuilderDir = Join-Path $env:TEMP "KproSetup-$Version"
$StubSource = Join-Path $BuilderDir "KproSetupStub.cs"
$StubExe = Join-Path $BuilderDir "KproSetupStub.exe"
$NodeExe = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$NpmCli = Join-Path $ProjectRoot ".tools\npm\bin\npm-cli.js"
$ElectronDist = Join-Path $ProjectRoot "node_modules\electron\dist"
$SqlJs = Join-Path $ProjectRoot "node_modules\sql.js"
$Csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$IconPath = Join-Path $ProjectRoot "public\k-pro-logo.ico"

function Copy-DirectoryContents($Source, $Destination) {
  if (!(Test-Path $Source)) {
    throw "Missing source: $Source"
  }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}

function Copy-ProjectFile($RelativePath, $DestinationRoot) {
  $source = Join-Path $ProjectRoot $RelativePath
  if (!(Test-Path $source)) {
    throw "Missing source: $source"
  }
  $destination = Join-Path $DestinationRoot $RelativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
}

if (!$SkipBuild) {
  if ((Test-Path $NodeExe) -and (Test-Path $NpmCli)) {
    & $NodeExe $NpmCli run build
  } else {
    npm run build
  }
}

if (!(Test-Path $ElectronDist)) {
  throw "Electron runtime not found: $ElectronDist"
}
if (!(Test-Path $SqlJs)) {
  throw "sql.js runtime not found: $SqlJs"
}
if (!(Test-Path $Csc)) {
  throw "C# compiler not found. It is required to create Setup.exe on Windows."
}
if (!(Test-Path $IconPath)) {
  throw "Setup icon not found: $IconPath"
}

New-Item -ItemType Directory -Path $ReleaseRoot -Force | Out-Null
foreach ($path in @($PackageDir, $SetupExe, $SetupZip)) {
  if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}
if (Test-Path $BuilderDir) {
  Remove-Item -LiteralPath $BuilderDir -Recurse -Force
}

New-Item -ItemType Directory -Path $AppFilesDir -Force | Out-Null
New-Item -ItemType Directory -Path $BuilderDir -Force | Out-Null

# Put Electron/Chromium runtime directly in the app root and rename the launcher.
Copy-DirectoryContents $ElectronDist $AppFilesDir
Copy-Item -LiteralPath (Join-Path $AppFilesDir "electron.exe") -Destination (Join-Path $AppFilesDir "K-pro.exe") -Force

Copy-DirectoryContents (Join-Path $ProjectRoot "dist") (Join-Path $AppFilesDir "dist")
Copy-DirectoryContents (Join-Path $ProjectRoot "dist-electron") (Join-Path $AppFilesDir "dist-electron")
Copy-DirectoryContents $SqlJs (Join-Path $AppFilesDir "node_modules\sql.js")

Copy-ProjectFile "package.json" $AppFilesDir
Copy-ProjectFile "Start-Kassa.ps1" $AppFilesDir
Copy-ProjectFile "KASSA-PRO.bat" $AppFilesDir
Copy-ProjectFile "src\shared\adminSeedData.json" $AppFilesDir

$installBat = @'
@echo off
setlocal
set "SRC=%~dp0app.zip"
set "DEST=%LOCALAPPDATA%\K-pro"
set "DESKTOP=%USERPROFILE%\Desktop"

echo Installing K-pro cash register...
if not exist "%SRC%" (
  echo app.zip not found next to installer files.
  pause
  exit /b 1
)

if exist "%DEST%" rmdir /s /q "%DEST%"
mkdir "%DEST%" >nul 2>nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%SRC%' -DestinationPath '%DEST%' -Force"
if errorlevel 1 (
  echo Install failed while extracting files.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$dest='%LOCALAPPDATA%\K-pro'; $ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\K-pro.lnk'); $s.TargetPath=(Join-Path $dest 'K-pro.exe'); $s.Arguments='.'; $s.WorkingDirectory=$dest; $s.IconLocation=(Join-Path $dest 'dist\k-pro-logo.ico'); $s.Save()"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$dest='%LOCALAPPDATA%\K-pro'; $programs=[Environment]::GetFolderPath('Programs'); $dir=Join-Path $programs 'K-pro'; New-Item -ItemType Directory -Force -Path $dir | Out-Null; $ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut((Join-Path $dir 'K-pro.lnk')); $s.TargetPath=(Join-Path $dest 'K-pro.exe'); $s.Arguments='.'; $s.WorkingDirectory=$dest; $s.IconLocation=(Join-Path $dest 'dist\k-pro-logo.ico'); $s.Save()"

echo.
echo Installed successfully.
echo Use the desktop shortcut: K-pro
echo Server: __SERVER_URL__
echo.
pause
'@
$installBat = $installBat.Replace("__SERVER_URL__", $ServerUrl)
$installBat | Set-Content -LiteralPath (Join-Path $PackageDir "Install-KASSA-PRO-Cash.bat") -Encoding ASCII

@'
@echo off
setlocal
set "DEST=%LOCALAPPDATA%\K-pro"
if exist "%USERPROFILE%\Desktop\K-pro.lnk" del "%USERPROFILE%\Desktop\K-pro.lnk"
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\K-pro" rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\K-pro"
if exist "%DEST%" rmdir /s /q "%DEST%"
echo K-pro removed. Local cash data in APPDATA is not removed.
pause
'@ | Set-Content -LiteralPath (Join-Path $PackageDir "Uninstall-KASSA-PRO-Cash.bat") -Encoding ASCII

@"
K-pro Cash Setup $Version

Install:
1. Run K-pro-Setup-$Version.exe.
2. Use the desktop shortcut "K-pro".
3. Enter the one-time register activation key from the control panel.

This setup includes Electron/Chromium, so Chrome, Node.js, npm and Electron do not need to be installed on the monoblock.

Server:
$ServerUrl

Cash data:
%APPDATA%\kassa-pro-desktop-server

If Windows SmartScreen warns about the app, choose "More info" and "Run anyway" for this unsigned test build.
"@ | Set-Content -LiteralPath (Join-Path $PackageDir "README-INSTALL.txt") -Encoding ASCII

Compress-Archive -Path (Join-Path $AppFilesDir "*") -DestinationPath $AppZip -Force

$stubCode = @'
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;

internal static class KproSetup
{
    private static readonly byte[] Marker = Encoding.ASCII.GetBytes("KPROZIPV1MARKER!");

    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Form progressForm = null;
        try
        {
            string exePath = Assembly.GetExecutingAssembly().Location;
            string tempZip = Path.Combine(Path.GetTempPath(), "kpro-app-" + Guid.NewGuid().ToString("N") + ".zip");
            string dest = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "K-pro");

            progressForm = CreateProgressForm();
            progressForm.Show();
            Application.DoEvents();

            ExtractEmbeddedZip(exePath, tempZip);

            KillRunningKpro(dest);
            PrepareInstallDirectory(dest);
            ZipFile.ExtractToDirectory(tempZip, dest);

            CreateShortcut(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "K-pro.lnk"),
                Path.Combine(dest, "K-pro.exe"),
                ".",
                dest,
                Path.Combine(dest, "dist", "k-pro-logo.ico")
            );

            string startMenuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "K-pro");
            Directory.CreateDirectory(startMenuDir);
            CreateShortcut(
                Path.Combine(startMenuDir, "K-pro.lnk"),
                Path.Combine(dest, "K-pro.exe"),
                ".",
                dest,
                Path.Combine(dest, "dist", "k-pro-logo.ico")
            );

            try { File.Delete(tempZip); } catch { }
            if (progressForm != null)
            {
                progressForm.Close();
                progressForm.Dispose();
                progressForm = null;
            }

            MessageBox.Show(
                "K-pro installed.\n\nStart the cash register from the desktop shortcut.",
                "K-pro Setup",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );
            return 0;
        }
        catch (Exception ex)
        {
            if (progressForm != null)
            {
                progressForm.Close();
                progressForm.Dispose();
            }
            MessageBox.Show(
                "K-pro was not installed correctly.\n\nClose K-pro if it is running, then run this setup again.\n\n" + ex.Message,
                "K-pro Setup",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return 1;
        }
    }

    private static Form CreateProgressForm()
    {
        Form form = new Form();
        form.Text = "K-pro Setup";
        form.Width = 430;
        form.Height = 230;
        form.StartPosition = FormStartPosition.CenterScreen;
        form.FormBorderStyle = FormBorderStyle.FixedDialog;
        form.MaximizeBox = false;
        form.MinimizeBox = false;
        form.BackColor = Color.White;

        Label logo = new Label();
        logo.Text = "K";
        logo.Left = 28;
        logo.Top = 26;
        logo.Width = 54;
        logo.Height = 54;
        logo.TextAlign = ContentAlignment.MiddleCenter;
        logo.Font = new Font("Segoe UI", 24, FontStyle.Bold);
        logo.ForeColor = Color.White;
        logo.BackColor = Color.FromArgb(20, 122, 223);
        form.Controls.Add(logo);

        Label title = new Label();
        title.Text = "Installing K-pro";
        title.Left = 98;
        title.Top = 28;
        title.Width = 280;
        title.Height = 28;
        title.Font = new Font("Segoe UI", 15, FontStyle.Bold);
        title.ForeColor = Color.FromArgb(19, 36, 58);
        form.Controls.Add(title);

        Label subtitle = new Label();
        subtitle.Text = "Installing the cash register for this computer. Chrome, Node.js and Electron are included.";
        subtitle.Left = 98;
        subtitle.Top = 62;
        subtitle.Width = 285;
        subtitle.Height = 45;
        subtitle.Font = new Font("Segoe UI", 9, FontStyle.Regular);
        subtitle.ForeColor = Color.FromArgb(83, 103, 127);
        form.Controls.Add(subtitle);

        ProgressBar progress = new ProgressBar();
        progress.Left = 28;
        progress.Top = 132;
        progress.Width = 354;
        progress.Height = 18;
        progress.Style = ProgressBarStyle.Marquee;
        progress.MarqueeAnimationSpeed = 28;
        form.Controls.Add(progress);

        Label status = new Label();
        status.Text = "Copying application files...";
        status.Left = 28;
        status.Top = 158;
        status.Width = 354;
        status.Height = 22;
        status.Font = new Font("Segoe UI", 9, FontStyle.Bold);
        status.ForeColor = Color.FromArgb(20, 122, 223);
        form.Controls.Add(status);

        return form;
    }

    private static void ExtractEmbeddedZip(string exePath, string tempZip)
    {
        using (FileStream fs = File.OpenRead(exePath))
        {
            if (fs.Length < Marker.Length + 8)
            {
                throw new InvalidDataException("The setup file does not contain application data.");
            }

            fs.Seek(-Marker.Length, SeekOrigin.End);
            byte[] markerRead = new byte[Marker.Length];
            ReadExact(fs, markerRead, markerRead.Length);
            for (int i = 0; i < Marker.Length; i++)
            {
                if (markerRead[i] != Marker[i])
                {
                    throw new InvalidDataException("The setup data marker is corrupted.");
                }
            }

            fs.Seek(-(Marker.Length + 8), SeekOrigin.End);
            byte[] lengthBytes = new byte[8];
            ReadExact(fs, lengthBytes, lengthBytes.Length);
            long zipLength = BitConverter.ToInt64(lengthBytes, 0);
            long zipStart = fs.Length - Marker.Length - 8 - zipLength;
            if (zipLength <= 0 || zipStart < 0)
            {
                throw new InvalidDataException("The application archive inside setup is corrupted.");
            }

            fs.Seek(zipStart, SeekOrigin.Begin);
            using (FileStream output = File.Create(tempZip))
            {
                byte[] buffer = new byte[1024 * 1024];
                long remaining = zipLength;
                while (remaining > 0)
                {
                    int read = fs.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                    if (read <= 0)
                    {
                        throw new EndOfStreamException();
                    }
                    output.Write(buffer, 0, read);
                    remaining -= read;
                }
            }
        }
    }

    private static void KillRunningKpro(string dest)
    {
        int currentId = Process.GetCurrentProcess().Id;
        string[] names = new string[] { "K-pro", "electron" };
        foreach (string name in names)
        {
            foreach (Process process in Process.GetProcessesByName(name))
            {
                try
                {
                    if (process.Id == currentId || !IsKproProcess(process, dest))
                    {
                        continue;
                    }

                    try { process.CloseMainWindow(); } catch { }
                    if (!process.WaitForExit(3000))
                    {
                        process.Kill();
                        process.WaitForExit(5000);
                    }
                }
                catch
                {
                    // Best effort. If the old app keeps files locked, PrepareInstallDirectory will show a clear error.
                }
                finally
                {
                    try { process.Dispose(); } catch { }
                }
            }
        }
    }

    private static bool IsKproProcess(Process process, string dest)
    {
        try
        {
            if (process.ProcessName.Equals("K-pro", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            string modulePath = process.MainModule != null ? process.MainModule.FileName : "";
            return !string.IsNullOrWhiteSpace(modulePath)
                && modulePath.StartsWith(dest, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static void PrepareInstallDirectory(string dest)
    {
        if (!Directory.Exists(dest))
        {
            Directory.CreateDirectory(dest);
            return;
        }

        Exception lastError = null;
        for (int attempt = 0; attempt < 6; attempt++)
        {
            try
            {
                Directory.Delete(dest, true);
                Directory.CreateDirectory(dest);
                return;
            }
            catch (Exception ex)
            {
                lastError = ex;
                Thread.Sleep(700);
            }
        }

        try
        {
            string oldDest = dest + ".old-" + DateTime.Now.ToString("yyyyMMddHHmmss");
            Directory.Move(dest, oldDest);
            Directory.CreateDirectory(dest);
            return;
        }
        catch (Exception ex)
        {
            throw new IOException(
                "Cannot replace the old K-pro files. Close the cash register and all K-pro windows, then run setup again. Original error: "
                + (lastError != null ? lastError.Message : ex.Message),
                ex
            );
        }
    }

    private static void ReadExact(Stream stream, byte[] buffer, int count)
    {
        int offset = 0;
        while (offset < count)
        {
            int read = stream.Read(buffer, offset, count - offset);
            if (read <= 0)
            {
                throw new EndOfStreamException();
            }
            offset += read;
        }
    }

    private static void CreateShortcut(string shortcutPath, string targetPath, string arguments, string workingDirectory, string iconPath)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(shellType);
        object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
        Type shortcutType = shortcut.GetType();
        shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath });
        shortcutType.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] { arguments });
        shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDirectory });
        if (File.Exists(iconPath))
        {
            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { iconPath });
        }
        shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
    }
}
'@
$stubCode | Set-Content -LiteralPath $StubSource -Encoding UTF8

& $Csc /nologo /target:winexe /platform:anycpu /win32icon:$IconPath /out:$StubExe /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll $StubSource
if ($LASTEXITCODE -ne 0) {
  throw "Setup stub compile failed with code $LASTEXITCODE"
}
if (!(Test-Path $StubExe)) {
  throw "Setup stub was not created: $StubExe"
}

$marker = [Text.Encoding]::ASCII.GetBytes("KPROZIPV1MARKER!")
$zipBytes = [IO.File]::ReadAllBytes($AppZip)
$lengthBytes = [BitConverter]::GetBytes([Int64]$zipBytes.Length)
$outStream = [IO.File]::Create($SetupExe)
try {
  $stubBytes = [IO.File]::ReadAllBytes($StubExe)
  $outStream.Write($stubBytes, 0, $stubBytes.Length)
  $outStream.Write($zipBytes, 0, $zipBytes.Length)
  $outStream.Write($lengthBytes, 0, $lengthBytes.Length)
  $outStream.Write($marker, 0, $marker.Length)
} finally {
  $outStream.Dispose()
}

$SetupZipStaging = Join-Path $PackageDir "zip"
New-Item -ItemType Directory -Path $SetupZipStaging -Force | Out-Null
Copy-Item -LiteralPath $SetupExe -Destination (Join-Path $SetupZipStaging (Split-Path -Leaf $SetupExe)) -Force
Copy-Item -LiteralPath (Join-Path $PackageDir "README-INSTALL.txt") -Destination (Join-Path $SetupZipStaging "README-INSTALL.txt") -Force
$zipItems = Get-ChildItem -LiteralPath $SetupZipStaging -Force | ForEach-Object { $_.FullName }
Compress-Archive -LiteralPath $zipItems -DestinationPath $SetupZip -Force

$sizeMb = [Math]::Round((Get-Item $SetupExe).Length / 1MB, 1)
$zipSizeMb = [Math]::Round((Get-Item $SetupZip).Length / 1MB, 1)
Write-Output "SETUP_EXE=$SetupExe"
Write-Output "SETUP_SIZE_MB=$sizeMb"
Write-Output "SETUP_ZIP=$SetupZip"
Write-Output "SETUP_ZIP_SIZE_MB=$zipSizeMb"
