# ============================================================
# El Perdonómetro · generador de iconos PNG
# Uso:  powershell -ExecutionPolicy Bypass -File tools\gen-icons.ps1
# Dibuja el frasco kawaii en varios tamaños para el manifest.
# ============================================================
param([string]$OutDir = (Join-Path $PSScriptRoot "..\icons"))

Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Get-Color([int]$r, [int]$g, [int]$b, [int]$a = 255) {
  return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $r * 2, $r * 2, 180, 90)
  $p.AddArc($x + $w - $r * 2, $y, $r * 2, $r * 2, 270, 90)
  $p.AddArc($x + $w - $r * 2, $y + $h - $r * 2, $r * 2, $r * 2, 0, 90)
  $p.AddArc($x, $y + $h - $r * 2, $r * 2, $r * 2, 90, 90)
  $p.CloseFigure()
  return $p
}

function Add-Estrella {
  param([System.Drawing.Graphics]$g, [float]$cx, [float]$cy, [float]$s,
        [System.Drawing.Color]$c)
  $puntos = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($cx, $cy - $s),
    [System.Drawing.PointF]::new($cx + $s * 0.3, $cy - $s * 0.3),
    [System.Drawing.PointF]::new($cx + $s, $cy),
    [System.Drawing.PointF]::new($cx + $s * 0.3, $cy + $s * 0.3),
    [System.Drawing.PointF]::new($cx, $cy + $s),
    [System.Drawing.PointF]::new($cx - $s * 0.3, $cy + $s * 0.3),
    [System.Drawing.PointF]::new($cx - $s, $cy),
    [System.Drawing.PointF]::new($cx - $s * 0.3, $cy - $s * 0.3)
  )
  $brush = [System.Drawing.SolidBrush]::new($c)
  $g.FillPolygon($brush, $puntos)
  $brush.Dispose()
}

# --- paleta pastel ---
$bgA       = Get-Color 207 242 255
$bgB       = Get-Color 140 220 247
$rosa      = Get-Color 255 208 228
$rosaOsc   = Get-Color 255 158 196
$vidrio    = Get-Color 255 255 255
$celesteOsc= Get-Color 127 212 245
$liquidoA  = Get-Color 140 224 180   # verde billete
$liquidoB  = Get-Color 69 177 126
$billeteC  = Get-Color 176 240 205   # banda clara de billete
$tinta     = Get-Color 63 93 117
$rubor     = Get-Color 255 182 209
$oro       = Get-Color 255 217 122
$oroOsc    = Get-Color 232 181 75
$sombra    = Get-Color 0 0 0 34
$blanco90  = Get-Color 255 255 255 230
$vidrioGradA = Get-Color 255 255 255 250
$vidrioGradB = Get-Color 234 248 255 250
$tapaGradA   = Get-Color 255 232 241

function New-Icon {
  param(
    [int]$Size,
    [string]$Path,
    [double]$EscalaArte = 1.0,   # margen extra (zona segura maskable)
    [double]$Redondeo = 0.22     # radio de esquinas del fondo (0 = a sangre)
  )

  $bmp = [System.Drawing.Bitmap]::new($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  # todo se dibuja en un espacio de 512x512 y se escala al tamaño final
  $k = $Size / 512.0
  $g.ScaleTransform([float]$k, [float]$k)

  # ---- fondo ----
  $rectFondo = [System.Drawing.Rectangle]::new(0, 0, 512, 512)
  $gradFondo = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rectFondo, $bgA, $bgB, 45)
  if ($Redondeo -gt 0) {
    $rutaFondo = New-RoundedPath 0 0 512 512 ([float](512 * $Redondeo))
    $g.FillPath($gradFondo, $rutaFondo)
    $rutaFondo.Dispose()
  } else {
    $g.FillRectangle($gradFondo, $rectFondo)
  }
  $gradFondo.Dispose()

  # nubecitas tenues
  $nube = [System.Drawing.SolidBrush]::new((Get-Color 255 255 255 110))
  $g.FillEllipse($nube, 40, 74, 120, 44)
  $g.FillEllipse($nube, 96, 52, 56, 56)
  $g.FillEllipse($nube, 350, 300, 130, 48)
  $g.FillEllipse($nube, 404, 276, 60, 60)
  $nube.Dispose()

  # ---- arte: centrado y escalado (respeta zona segura maskable) ----
  $g.TranslateTransform(256, 256)
  $g.ScaleTransform([float]$EscalaArte, [float]$EscalaArte)
  $g.TranslateTransform(-256, -256)

  # sombra bajo el frasco
  $brushSombra = [System.Drawing.SolidBrush]::new($sombra)
  $g.FillEllipse($brushSombra, 168, 438, 176, 30)
  $brushSombra.Dispose()

  # cuello (vidrio)
  $rutaCuello = New-RoundedPath 176 176 160 70 18
  $brushCuello = [System.Drawing.SolidBrush]::new($vidrio)
  $g.FillPath($brushCuello, $rutaCuello)
  $brushCuello.Dispose()
  $rutaCuello.Dispose()

  # cuerpo del frasco
  $rutaCuerpo = New-RoundedPath 148 200 216 250 54
  $rectCuerpo = [System.Drawing.Rectangle]::new(148, 200, 216, 250)
  $brushCuerpo = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rectCuerpo, $vidrioGradA, $vidrioGradB, 90)
  $g.FillPath($brushCuerpo, $rutaCuerpo)
  $brushCuerpo.Dispose()

  # "billetes" dentro del cuerpo (recortados al frasco)
  $estado = $g.Save()
  $g.SetClip($rutaCuerpo)
  $rectLiq = [System.Drawing.Rectangle]::new(148, 348, 216, 110)
  $gradLiq = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rectLiq, $liquidoA, $liquidoB, 90)
  $g.FillRectangle($gradLiq, 140, 372, 240, 110)
  $g.FillEllipse($gradLiq, 130, 346, 260, 52)   # "superficie" redonda
  $gradLiq.Dispose()
  # bandas claras que simulan billetes apilados
  $banda = [System.Drawing.SolidBrush]::new($billeteC)
  $g.FillRectangle($banda, 140, 396, 240, 12)
  $g.FillRectangle($banda, 140, 436, 240, 12)
  $banda.Dispose()
  $g.Restore($estado)

  # borde del cuerpo
  $penVidrio = [System.Drawing.Pen]::new($celesteOsc, 11)
  $penVidrio.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPath($penVidrio, $rutaCuerpo)
  $penVidrio.Dispose()
  $rutaCuerpo.Dispose()

  # tapa rosa
  $rutaTapa = New-RoundedPath 138 132 236 66 26
  $rectTapa = [System.Drawing.Rectangle]::new(138, 132, 236, 66)
  $brushTapa = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rectTapa, $tapaGradA, $rosa, 90)
  $g.FillPath($brushTapa, $rutaTapa)
  $brushTapa.Dispose()
  $penTapa = [System.Drawing.Pen]::new($rosaOsc, 11)
  $penTapa.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPath($penTapa, $rutaTapa)
  $penTapa.Dispose()
  $rutaTapa.Dispose()
  $brilloTapa = [System.Drawing.SolidBrush]::new($blanco90)
  $g.FillRectangle($brilloTapa, 168, 148, 176, 14)
  $brilloTapa.Dispose()

  # cara kawaii
  $brushOjo = [System.Drawing.SolidBrush]::new($tinta)
  $g.FillEllipse($brushOjo, 200, 268, 34, 34)
  $g.FillEllipse($brushOjo, 278, 268, 34, 34)
  $brushOjo.Dispose()
  $punto = [System.Drawing.SolidBrush]::new($blanco90)
  $g.FillEllipse($punto, 209, 275, 13, 13)
  $g.FillEllipse($punto, 287, 275, 13, 13)
  $punto.Dispose()

  $brushRubor = [System.Drawing.SolidBrush]::new($rubor)
  $g.FillEllipse($brushRubor, 172, 312, 44, 24)
  $g.FillEllipse($brushRubor, 296, 312, 44, 24)
  $brushRubor.Dispose()

  $penSonrisa = [System.Drawing.Pen]::new($tinta, 11)
  $penSonrisa.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $penSonrisa.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($penSonrisa, 226, 306, 60, 48, 25, 130)
  $penSonrisa.Dispose()

  # monedita dorada
  $brushOro = [System.Drawing.SolidBrush]::new($oro)
  $g.FillEllipse($brushOro, 344, 388, 76, 76)
  $brushOro.Dispose()
  $penOro = [System.Drawing.Pen]::new($oroOsc, 8)
  $g.DrawEllipse($penOro, 344, 388, 76, 76)
  $penOro.Dispose()
  $penOro2 = [System.Drawing.Pen]::new($oroOsc, 6)
  $g.DrawEllipse($penOro2, 362, 406, 40, 40)
  $penOro2.Dispose()

  # destellos
  Add-Estrella $g 108 168 26 $blanco90
  Add-Estrella $g 424 156 20 $blanco90
  Add-Estrella $g 96 392 18 $blanco90

  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "  OK  $Path"
}

Write-Host "Generando iconos del Perdonometro..."
New-Icon -Size 512 -Path (Join-Path $OutDir "icon-512.png")        -EscalaArte 1.0  -Redondeo 0.22
New-Icon -Size 192 -Path (Join-Path $OutDir "icon-192.png")        -EscalaArte 1.0  -Redondeo 0.22
New-Icon -Size 512 -Path (Join-Path $OutDir "icon-maskable-512.png") -EscalaArte 0.78 -Redondeo 0
New-Icon -Size 180 -Path (Join-Path $OutDir "apple-touch-icon.png")  -EscalaArte 0.86 -Redondeo 0
New-Icon -Size 64  -Path (Join-Path $OutDir "favicon.png")          -EscalaArte 1.0  -Redondeo 0.22
Write-Host "Listo!"
