param(
    [string]$PdfFolder = 'D:\App\Programs',
    [string]$OutputFolder = 'artifacts/pdf-import-corpus',
    [string]$Python = 'python'
)

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$outputPath = if ([System.IO.Path]::IsPathRooted($OutputFolder)) { $OutputFolder } else { Join-Path $repository $OutputFolder }
$output = [System.IO.Path]::GetFullPath($outputPath)
$pdfRoot = (Resolve-Path -LiteralPath $PdfFolder).Path
$previousCorpus = $env:WORKOUT_PDF_CORPUS
$previousDump = $env:WORKOUT_CORPUS_DUMP
$previousFilter = $env:WORKOUT_CORPUS_FILTER

try {
    # An exhaustive audit must not inherit a developer's single-fixture filter.
    $env:WORKOUT_CORPUS_FILTER = $null
    Push-Location (Join-Path $repository 'web')
    try {
        & node node_modules/vite-node/vite-node.mjs scripts/pdf-corpus.ts $pdfRoot $output
        if ($LASTEXITCODE -ne 0) { throw 'Browser-equivalent PDF extraction failed.' }
    } finally { Pop-Location }

    $env:WORKOUT_PDF_CORPUS = $output
    $env:WORKOUT_CORPUS_DUMP = '1'
    Push-Location $repository
    try {
        & dotnet test tests/Workout.Tests.csproj --artifacts-path artifacts/pdf-audit-tests --filter FullyQualifiedName~CorpusReport
        if ($LASTEXITCODE -ne 0) { throw 'Normal/drift import replay failed.' }
        & $Python scripts/pdf-audit-gate.py tests/Corpus/SourceExpected/prescriptions.json.gz tests/Corpus/SourceExpected/links.json.gz tests/Corpus/SourceExpected/inventory.json $output (Join-Path $output 'source-audit')
        if ($LASTEXITCODE -ne 0) { throw 'Independent source fidelity or coverage gate failed.' }
    } finally { Pop-Location }
} finally {
    $env:WORKOUT_PDF_CORPUS = $previousCorpus
    $env:WORKOUT_CORPUS_DUMP = $previousDump
    $env:WORKOUT_CORPUS_FILTER = $previousFilter
}
