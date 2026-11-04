import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PICKER = String.raw`
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
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '가져올 규격 이슈 문서 선택 (내용은 로컬에 저장됩니다)'
$dialog.Filter = 'Markdown 문서 (*.md)|*.md'
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
$dialog.DereferenceLinks = $false
try {
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $owner.Show()
  $owner.Activate()
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.FileName) }
} finally { $dialog.Dispose(); $owner.Dispose() }
`;
const SAVE_PICKER = String.raw`
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
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = '프로젝트 안에 새 이슈 문서 저장 (기존 파일 덮어쓰기 불가)'
$dialog.Filter = 'Markdown 문서 (*.md)|*.md'
$dialog.InitialDirectory = $env:AUTOCODEX_ISSUE_EXPORT_ROOT
$dialog.FileName = 'issue-plan.md'
$dialog.AddExtension = $true
$dialog.DefaultExt = 'md'
$dialog.CheckPathExists = $true
$dialog.OverwritePrompt = $false
$dialog.DereferenceLinks = $false
try {
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $owner.Show()
  $owner.Activate()
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.FileName) }
} finally { $dialog.Dispose(); $owner.Dispose() }
`;
const SOURCE_PICKER = String.raw`
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
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '프로젝트 안에서 미리 볼 자료 선택 (모델 전송 없음)'
$dialog.Filter = 'Markdown 및 텍스트 (*.md;*.txt)|*.md;*.txt'
$dialog.InitialDirectory = $env:AUTOCODEX_ISSUE_SOURCE_ROOT
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
$dialog.DereferenceLinks = $false
try {
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $owner.Show()
  $owner.Activate()
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.FileName) }
} finally { $dialog.Dispose(); $owner.Dispose() }
`;

/** The path comes only from a native user selection and is never accepted from the renderer. */
export async function pickIssueDocument(signal?: AbortSignal): Promise<string | null> {
  if (process.platform !== "win32") throw new Error("현재 이슈 문서 선택창은 Windows에서만 지원합니다.");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-STA", "-Command", PICKER], {
    encoding: "utf8", windowsHide: false, timeout: 5 * 60_000, maxBuffer: 16 * 1024, signal,
  });
  return stdout.replace(/^\uFEFF/, "").trim() || null;
}

/** This chooses a path only; the bridge separately validates and creates a new file. */
export async function pickIssueExportPath(projectPath: string, signal?: AbortSignal): Promise<string | null> {
  if (process.platform !== "win32") throw new Error("현재 이슈 문서 저장창은 Windows에서만 지원합니다.");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-STA", "-Command", SAVE_PICKER], {
    encoding: "utf8", windowsHide: false, timeout:  5 * 60_000, maxBuffer: 16 * 1024, signal,
    env: { ...process.env, AUTOCODEX_ISSUE_EXPORT_ROOT: projectPath },
  });
  return stdout.replace(/^\uFEFF/, "").trim() || null;
}

export async function pickAnalysisSource(projectPath: string, signal?: AbortSignal): Promise<string | null> {
  if (process.platform !== "win32") throw new Error("현재 자료 선택창은 Windows에서만 지원합니다.");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-STA", "-Command", SOURCE_PICKER], {
    encoding: "utf8", windowsHide: false, timeout: 5 * 60_000, maxBuffer: 16 * 1024, signal,
    env: { ...process.env, AUTOCODEX_ISSUE_SOURCE_ROOT: projectPath },
  });
  return stdout.replace(/^\uFEFF/, "").trim() || null;
}
