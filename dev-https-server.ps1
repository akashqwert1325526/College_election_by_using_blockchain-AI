param(
  [int]$Port = 5500,
  [string]$Root = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$rsa = [System.Security.Cryptography.RSA]::Create(2048)
$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
  "CN=localhost",
  $rsa,
  [System.Security.Cryptography.HashAlgorithmName]::SHA256,
  [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
)

$san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName("localhost")
$san.AddIpAddress([System.Net.IPAddress]::Parse("127.0.0.1"))
$san.AddIpAddress([System.Net.IPAddress]::Parse("::1"))
$request.CertificateExtensions.Add($san.Build())
$request.CertificateExtensions.Add(
  [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $false)
)
$request.CertificateExtensions.Add(
  [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
    [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor
      [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment,
    $false
  )
)

$generatedCert = $request.CreateSelfSigned(
  [DateTimeOffset]::Now.AddDays(-1),
  [DateTimeOffset]::Now.AddYears(2)
)
$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
  $generatedCert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, "dev-localhost"),
  "dev-localhost",
  [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable -bor
    [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::PersistKeySet -bor
    [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::UserKeySet
)

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png" = "image/png"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".svg" = "image/svg+xml"
  ".ico" = "image/x-icon"
  ".txt" = "text/plain; charset=utf-8"
}

function Resolve-StaticPath {
  param([string]$UrlPath)

  $pathOnly = ($UrlPath -split "\?")[0]
  if ([string]::IsNullOrWhiteSpace($pathOnly) -or $pathOnly -eq "/") {
    $pathOnly = "/index.html"
  }

  $relative = [Uri]::UnescapeDataString($pathOnly.TrimStart("/")).Replace("/", [IO.Path]::DirectorySeparatorChar)
  $fullPath = [IO.Path]::GetFullPath((Join-Path $Root $relative))
  $rootPath = [IO.Path]::GetFullPath($Root)

  if (-not $fullPath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }

  return $fullPath
}

function Write-Response {
  param(
    [System.IO.Stream]$Stream,
    [int]$Status,
    [string]$StatusText,
    [byte[]]$Body,
    [string]$ContentType
  )

  $headers = @(
    "HTTP/1.1 $Status $StatusText",
    "Content-Type: $ContentType",
    "Content-Length: $($Body.Length)",
    "Cache-Control: no-store",
    "Connection: close",
    "",
    ""
  ) -join "`r`n"

  $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "SecureVote HTTPS server running at https://localhost:$Port"

while ($true) {
  $client = $listener.AcceptTcpClient()

  try {
    $ssl = [System.Net.Security.SslStream]::new($client.GetStream(), $false)
    $ssl.AuthenticateAsServer($cert, $false, [System.Security.Authentication.SslProtocols]::Tls12, $false)

    $reader = [System.IO.StreamReader]::new($ssl, [Text.Encoding]::ASCII, $false, 1024, $true)
    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) {
      $ssl.Close()
      $client.Close()
      continue
    }

    while (-not [string]::IsNullOrWhiteSpace($reader.ReadLine())) {}

    $parts = $requestLine.Split(" ")
    $method = $parts[0]
    $urlPath = $parts[1]

    if ($method -ne "GET" -and $method -ne "HEAD") {
      $body = [Text.Encoding]::UTF8.GetBytes("Method not allowed")
      Write-Response $ssl 405 "Method Not Allowed" $body "text/plain; charset=utf-8"
    } else {
      $filePath = Resolve-StaticPath $urlPath
      if ($null -eq $filePath -or -not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        $body = [Text.Encoding]::UTF8.GetBytes("Not found")
        Write-Response $ssl 404 "Not Found" $body "text/plain; charset=utf-8"
      } else {
        $ext = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
        $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
        $body = if ($method -eq "HEAD") { [byte[]]::new(0) } else { [IO.File]::ReadAllBytes($filePath) }
        Write-Response $ssl 200 "OK" $body $contentType
      }
    }

    $ssl.Flush()
    $ssl.Close()
  } catch {
    Write-Warning $_.Exception.Message
  } finally {
    $client.Close()
  }
}
