from __future__ import annotations

import datetime as dt
import http.server
import ipaddress
import pathlib
import ssl
import sys


ROOT = pathlib.Path(__file__).resolve().parent
DEPS = ROOT / ".devdeps"
CERT_PATH = ROOT / "dev-localhost.crt"
KEY_PATH = ROOT / "dev-localhost.key"

if DEPS.exists():
    sys.path.insert(0, str(DEPS))


def ensure_certificate() -> None:
    if CERT_PATH.exists() and CERT_PATH.stat().st_size and KEY_PATH.exists() and KEY_PATH.stat().st_size:
        return

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SecureVote Local Dev"),
            x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
        ]
    )
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=730))
        .add_extension(
            x509.SubjectAlternativeName(
                [
                    x509.DNSName("localhost"),
                    x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                    x509.IPAddress(ipaddress.ip_address("::1")),
                ]
            ),
            critical=False,
        )
        .sign(private_key, hashes.SHA256())
    )

    CERT_PATH.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    KEY_PATH.write_bytes(
        private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )


class StaticHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
    ensure_certificate()

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), StaticHandler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=CERT_PATH, keyfile=KEY_PATH)
    server.socket = context.wrap_socket(server.socket, server_side=True)

    print(f"SecureVote HTTPS server running at https://localhost:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
