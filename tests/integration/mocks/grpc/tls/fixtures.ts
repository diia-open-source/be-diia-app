import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CA_CONFIG = `[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no
[dn]
CN = Test CA
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
`

const SERVER_CONFIG = `[req]
distinguished_name = dn
req_extensions = v3_req
prompt = no
[dn]
CN = localhost
[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
`

const CLIENT_CONFIG = `[req]
distinguished_name = dn
req_extensions = v3_req
prompt = no
[dn]
CN = test-grpc-client
[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature,keyEncipherment
extendedKeyUsage = clientAuth
`

export function generateTlsFixtures(dir: string): void {
    rmSync(dir, { recursive: true, force: true })
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    mkdirSync(dir, { recursive: true })

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(join(dir, 'ca.cnf'), CA_CONFIG)
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(join(dir, 'server.cnf'), SERVER_CONFIG)
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(join(dir, 'client.cnf'), CLIENT_CONFIG)

    const openssl = (args: string[]): void => {
        execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' })
    }

    openssl(['genrsa', '-out', 'ca.key', '2048'])
    openssl(['req', '-x509', '-new', '-nodes', '-key', 'ca.key', '-sha256', '-days', '3650', '-out', 'ca.crt', '-config', 'ca.cnf'])

    openssl(['genrsa', '-out', 'server.key', '2048'])
    openssl(['req', '-new', '-key', 'server.key', '-out', 'server.csr', '-config', 'server.cnf'])
    openssl([
        'x509',
        '-req',
        '-in',
        'server.csr',
        '-CA',
        'ca.crt',
        '-CAkey',
        'ca.key',
        '-CAcreateserial',
        '-out',
        'server.crt',
        '-days',
        '3650',
        '-sha256',
        '-extfile',
        'server.cnf',
        '-extensions',
        'v3_req',
    ])

    openssl(['genrsa', '-out', 'client.key', '2048'])
    openssl(['req', '-new', '-key', 'client.key', '-out', 'client.csr', '-config', 'client.cnf'])
    openssl([
        'x509',
        '-req',
        '-in',
        'client.csr',
        '-CA',
        'ca.crt',
        '-CAkey',
        'ca.key',
        '-CAcreateserial',
        '-out',
        'client.crt',
        '-days',
        '3650',
        '-sha256',
        '-extfile',
        'client.cnf',
        '-extensions',
        'v3_req',
    ])
}
