import { GrpcServiceBinding, GrpcServicePortBinding } from '../interfaces/grpc.js'
import { hasProperty } from './utils.js'

export function groupServicesByPort(services: GrpcServiceBinding[], defaultPort: number): Map<number, string[]> {
    const servicesByPort = new Map<number, string[]>([[defaultPort, []]])

    for (const entry of services) {
        const { name, port } = parseServiceBinding(entry, defaultPort)

        servicesByPort.set(port, [...(servicesByPort.get(port) ?? []), name])
    }

    return servicesByPort
}

function parseServiceBinding(entry: unknown, defaultPort: number): GrpcServicePortBinding {
    if (typeof entry === 'string' && entry) {
        return { name: entry, port: defaultPort }
    }

    if (hasProperty(entry, 'name') && hasProperty(entry, 'port')) {
        const { name, port } = entry
        if (typeof name === 'string' && name && Number.isInteger(port) && Number(port) >= 1 && Number(port) <= 65535) {
            return { name, port: Number(port) }
        }
    }

    throw new Error(`Invalid grpc service entry ${JSON.stringify(entry)}: expected a service name or { "name": string, "port": 1-65535 }`)
}
