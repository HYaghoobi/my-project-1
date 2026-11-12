$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$port = if ($env:PORT) { $env:PORT } else { '8000' }
$imageName = 'pm-app'
$containerName = 'pm-app'

docker build -t $imageName -f (Join-Path $root 'Dockerfile') $root
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$existingContainer = docker container ls -a --filter "name=^/$containerName$" --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
if ($existingContainer -contains $containerName) {
    docker rm -f $containerName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

$runArgs = @(
    'run', '--detach', '--name', $containerName,
    '--publish', "${port}:8000",
    '--volume', 'pm-data:/app/data'
)
if (Test-Path (Join-Path $root '.env')) {
    $runArgs += @('--env-file', (Join-Path $root '.env'))
}
$runArgs += @('--restart', 'unless-stopped', $imageName)

docker @runArgs
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Output "Project Manager is available at http://localhost:$port"
