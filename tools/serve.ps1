# ============================================================
# El Perdonómetro · servidor local mínimo (solo para probar)
# Uso:  powershell -ExecutionPolicy Bypass -File tools\serve.ps1
# Luego abre  http://localhost:8765/
# ============================================================
param(
  [int]$Port = 8765,
  [string]$Root = (Join-Path $PSScriptRoot "..")
)

$ErrorActionPreference = "Stop"
$rootPath = (Resolve-Path $Root).Path

$mime = @{
  ".html"      = "text/html; charset=utf-8"
  ".css"       = "text/css; charset=utf-8"
  ".js"        = "text/javascript; charset=utf-8"
  ".json"      = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".png"       = "image/png"
  ".svg"       = "image/svg+xml"
  ".ico"       = "image/x-icon"
  ".txt"       = "text/plain; charset=utf-8"
}

$tcp = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$tcp.Start()
Write-Host "Sirviendo $rootPath  ->  http://localhost:$Port/  (Ctrl+C para parar)"

function Respond($stream, [int]$code, [string]$status, $bytes, [string]$type) {
  $head = "HTTP/1.1 $code $status`r`nContent-Type: $type`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($bytes -and $bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) }
  $stream.Flush()
}

while ($true) {
  $cliente = $tcp.AcceptTcpClient()
  try {
    $stream = $cliente.GetStream()
    $lector = New-Object System.IO.StreamReader($stream)
    $linea = $lector.ReadLine()
    while ($true) { $l = $lector.ReadLine(); if ($null -eq $l -or $l -eq "") { break } }
    if (-not $linea) { $cliente.Close(); continue }

    $partes = $linea.Split(" ")
    $ruta = [System.Uri]::UnescapeDataString($partes[1])
    if ($ruta -eq "/") { $ruta = "/index.html" }
    if ($ruta.Contains("?")) { $ruta = $ruta.Split("?")[0] }

    $archivo = Join-Path $rootPath ($ruta.TrimStart("/").Replace("/", "\"))
    $dentro = $archivo.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)

    if ($dentro -and (Test-Path $archivo) -and -not (Get-Item $archivo).PSIsContainer) {
      $bytes = [System.IO.File]::ReadAllBytes($archivo)
      $ext = [System.IO.Path]::GetExtension($archivo).ToLower()
      $tipo = $mime[$ext]
      if (-not $tipo) { $tipo = "application/octet-stream" }
      Respond $stream 200 "OK" $bytes $tipo
    } else {
      $404 = [System.Text.Encoding]::UTF8.GetBytes("No encontrado")
      Respond $stream 404 "Not Found" $404 "text/plain; charset=utf-8"
    }
    $stream.Dispose()
  } catch {
    Write-Warning $_.Exception.Message
  } finally {
    $cliente.Close()
  }
}
