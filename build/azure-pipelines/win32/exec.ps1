

function Exec
{
	[CmdletBinding()]
	param(
		[Parameter(Position=0,Mandatory=1)][scriptblock]$cmd,
		[Parameter(Position=1,Mandatory=0)][string]$errorMessage
	)
	& $cmd
	if ($lastexitcode -ne 0) {
		if (-not $errorMessage) {
			$errorMessage = "Command ``$cmd`` failed with exit code $lastexitcode"
		}
		throw ("Exec: " + $errorMessage)
	}
}