$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repoRoot 'control\CrewboardControl.cs'
$outputPath = Join-Path $repoRoot 'Crewboard Control.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $compiler)) {
    throw 'The Windows .NET Framework C# compiler is not installed.'
}

& $compiler /nologo /target:winexe "/out:$outputPath" /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll $sourcePath
if ($LASTEXITCODE -ne 0) { throw "Crewboard Control build failed with exit code $LASTEXITCODE." }
Write-Output "Built $outputPath"
