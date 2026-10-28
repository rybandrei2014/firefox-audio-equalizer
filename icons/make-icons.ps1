Add-Type -AssemblyName System.Drawing

function New-EqIcon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = $size / 96.0
  $bg = [System.Drawing.Color]::FromArgb(255, 28, 30, 36)
  $accent = [System.Drawing.Color]::FromArgb(255, 76, 141, 255)
  $line = [System.Drawing.Color]::FromArgb(255, 154, 163, 178)

  # rounded background
  $r = 18 * $s
  $rect = New-Object System.Drawing.RectangleF(0, 0, ($size - 1), ($size - 1))
  $path2 = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path2.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path2.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $path2.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $path2.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $path2.CloseFigure()
  $bgBrush = New-Object System.Drawing.SolidBrush($bg)
  $g.FillPath($bgBrush, $path2)

  # three slider tracks + knobs
  $pen = New-Object System.Drawing.Pen($line, [Math]::Max(2.0, 6.0 * $s))
  $knobBrush = New-Object System.Drawing.SolidBrush($accent)
  $trackStart = 20 * $s; $trackEnd = 76 * $s
  $ys = @(28, 48, 68)
  $kx = @(58, 34, 66)
  for ($i = 0; $i -lt 3; $i++) {
    $y = $ys[$i] * $s
    $g.DrawLine($pen, $trackStart, $y, $trackEnd, $y)
    $kr = 8 * $s
    $kxc = $kx[$i] * $s
    $g.FillEllipse($knobBrush, ($kxc - $kr), ($y - $kr), ($kr * 2), ($kr * 2))
  }

  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "wrote $path"
}

New-EqIcon 48 "$PSScriptRoot\..\icons\eq48.png"
New-EqIcon 96 "$PSScriptRoot\..\icons\eq96.png"
