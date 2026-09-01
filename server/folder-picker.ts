import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WINDOWS_PICKER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'Auto Codex'
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Auto Codex에서 사용할 프로젝트 폴더를 선택하세요.'
$dialog.ShowNewFolderButton = $true
try {
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $owner.Show()
  $owner.Activate()
  $result = $dialog.ShowDialog($owner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Write($dialog.SelectedPath)
  }
} finally {
  $dialog.Dispose()
  $owner.Dispose()
}
`;

export async function pickProjectDirectory(): Promise<string | null> {
  if (process.platform !== "win32") {
    throw new Error("현재 폴더 선택창은 Windows에서만 지원합니다. 경로를 직접 입력해 주세요.");
  }

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-STA", "-Command", WINDOWS_PICKER_SCRIPT],
    {
      encoding: "utf8",
      // FolderBrowserDialog is an interactive desktop window. Keep its host
      // visible so Windows does not suppress or background the picker.
      windowsHide: false,
      timeout: 5 * 60_000,
      maxBuffer: 16 * 1024,
    },
  );
  const selectedPath = stdout.replace(/^\uFEFF/, "").trim();
  return selectedPath || null;
}
