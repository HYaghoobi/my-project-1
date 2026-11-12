$ErrorActionPreference = 'Stop'
$containerName = 'pm-app'

$existingContainer = docker container ls -a --filter "name=^/$containerName$" --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
if ($existingContainer -notcontains $containerName) {
    Write-Output "Container $containerName does not exist."
    exit 0
}

$runningContainer = docker container ls --filter "name=^/$containerName$" --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
if ($runningContainer -contains $containerName) {
    docker stop $containerName
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
else {
    Write-Output "Container $containerName is already stopped."
}
