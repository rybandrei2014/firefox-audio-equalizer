$sr = 48000; $secs = 3; $n = $sr * $secs
$fs = [System.IO.File]::Create("$PSScriptRoot\fixtures\tone.wav")
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([System.Text.Encoding]::ASCII.GetBytes("RIFF"))
$bw.Write([uint32](36 + $n * 2))
$bw.Write([System.Text.Encoding]::ASCII.GetBytes("WAVEfmt "))
$bw.Write([uint32]16); $bw.Write([uint16]1); $bw.Write([uint16]1)
$bw.Write([uint32]$sr); $bw.Write([uint32]($sr * 2)); $bw.Write([uint16]2); $bw.Write([uint16]16)
$bw.Write([System.Text.Encoding]::ASCII.GetBytes("data"))
$bw.Write([uint32]($n * 2))
for ($i = 0; $i -lt $n; $i++) {
  $t = $i / $sr
  if ($t -lt 1.0) { $f = 31.5 } elseif ($t -lt 2.0) { $f = 1000.0 } else { $f = 16000.0 }
  $frac = $t % 1.0
  $fade = [Math]::Min($frac, 1.0 - $frac) * 50.0
  if ($fade -gt 1.0) { $fade = 1.0 }
  $v = [Math]::Sin(2 * [Math]::PI * $f * $t) * 0.5 * $fade * 32767.0
  $bw.Write([int16][Math]::Round($v))
}
$bw.Close()
Write-Output "wrote tone.wav $((Get-Item "$PSScriptRoot\fixtures\tone.wav").Length) bytes"
