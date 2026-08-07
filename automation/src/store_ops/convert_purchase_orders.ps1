param(
  [Parameter(Mandatory = $true)][string]$SourceDirectory,
  [Parameter(Mandatory = $true)][string]$DestinationDirectory
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
New-Item -ItemType Directory -Force -Path $DestinationDirectory | Out-Null
$excel = $null
$converted = [System.Collections.Generic.List[string]]::new()
$errors = [System.Collections.Generic.List[object]]::new()

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3

  foreach ($file in Get-ChildItem -LiteralPath $SourceDirectory -File | Where-Object { $_.Extension -in '.xls', '.xlsx' } | Sort-Object Name) {
    $destination = Join-Path $DestinationDirectory ($file.BaseName + '.xlsx')
    if ($file.Extension -eq '.xlsx') {
      Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
      $converted.Add($destination)
      continue
    }
    $workbook = $null
    try {
      $workbook = $excel.Workbooks.Open($file.FullName, 0, $true, 5, "", "", $true)
      $workbook.SaveAs($destination, 51)
      $converted.Add($destination)
    } catch {
      $errors.Add([pscustomobject]@{ file = $file.Name; error = $_.Exception.Message })
    } finally {
      if ($null -ne $workbook) {
        $workbook.Close($false)
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($workbook)
      }
    }
  }
} finally {
  if ($null -ne $excel) {
    $excel.Quit()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

[pscustomobject]@{ converted = $converted; errors = $errors } | ConvertTo-Json -Depth 4 -Compress
