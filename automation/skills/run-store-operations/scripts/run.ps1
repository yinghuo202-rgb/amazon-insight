param(
    [Parameter(Position = 0)]
    [ValidateSet("init", "audit-skus", "status")]
    [string]$Command = "status"
)

$SkillRoot = Split-Path -Parent $PSScriptRoot
$ProjectRoot = (Resolve-Path (Join-Path $SkillRoot "..\..")).Path
& (Join-Path $ProjectRoot "ops.ps1") $Command
exit $LASTEXITCODE
