param(
    [Parameter(Position = 0)]
    [ValidateSet("init", "audit-skus", "build-inventory-dashboard-data", "build-product-catalog", "build-content-workflow", "build-document-master", "build-purchase-plan", "status")]
    [string]$Command = "status"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PYTHONPATH = Join-Path $ProjectRoot "src"

python -m store_ops --config (Join-Path $ProjectRoot "config\project.json") $Command
exit $LASTEXITCODE
