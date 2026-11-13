$ErrorActionPreference = 'Stop'

# Run locally in your terminal. The password is hidden, passed over stdin,
# and never placed in command arguments, environment variables, or files.
$nodePath = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$securePassword = Read-Host 'Enter the password you want to use for admin login' -AsSecureString
$passwordPointer = [IntPtr]::Zero
$hashProcess = $null
$plainPassword = $null
$passwordBytes = $null

try {
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    if ([string]::IsNullOrEmpty($plainPassword) -or $plainPassword.Length -gt 512) {
        throw 'Use a non-empty password of at most 512 characters.'
    }

    $nodeCode = "const fs=require('node:fs'),crypto=require('node:crypto');const password=fs.readFileSync(0,'utf8');const salt=crypto.randomBytes(32).toString('hex');const digest=crypto.scryptSync(password,salt,64).toString('hex');console.log('VOTING_ADMIN_PASSWORD_HASH='+salt+':'+digest);"
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodePath
    $startInfo.Arguments = '-e "' + $nodeCode + '"'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true

    $hashProcess = New-Object System.Diagnostics.Process
    $hashProcess.StartInfo = $startInfo
    [void]$hashProcess.Start()
    $passwordBytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($plainPassword)
    $hashProcess.StandardInput.BaseStream.Write($passwordBytes, 0, $passwordBytes.Length)
    $hashProcess.StandardInput.BaseStream.Close()
    $outputLine = $hashProcess.StandardOutput.ReadToEnd().Trim()
    $hashProcess.WaitForExit()
    if ($hashProcess.ExitCode -ne 0 -or $outputLine -notmatch '^VOTING_ADMIN_PASSWORD_HASH=[a-f0-9]{64}:[a-f0-9]{128}$') {
        throw 'Password hash generation failed.'
    }

    Write-Host ''
    Write-Host 'Replace the existing VOTING_ADMIN_PASSWORD_HASH line in your backend environment file with:'
    Write-Output $outputLine
    Write-Host ''
    Write-Host 'Restart the backend, then log in using the password you entered, not this hash.'
}
finally {
    $plainPassword = $null
    if ($null -ne $passwordBytes) { [Array]::Clear($passwordBytes, 0, $passwordBytes.Length) }
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    if ($null -ne $hashProcess) { $hashProcess.Dispose() }
    $securePassword.Dispose()
}
