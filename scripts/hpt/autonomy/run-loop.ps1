# Thin wrapper; the orchestrator is run-loop.js. Usage: pwsh scripts/hpt/autonomy/run-loop.ps1 --batch 3 --max-iterations 50
node "$PSScriptRoot/run-loop.js" @args
exit $LASTEXITCODE
