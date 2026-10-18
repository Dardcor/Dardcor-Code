function Retry
{
	[CmdletBinding()]
	param(
		[Parameter(Position=0,Mandatory=1)][scriptblock]$cmd
	)
	$retry = 0

	while ($retry++ -lt 5) {
		try {
			& $cmd
			return
		} catch {
		}
	}

	throw "Max retries reached"
}
