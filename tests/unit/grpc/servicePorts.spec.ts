import { groupServicesByPort } from '../../../src/grpc/servicePorts'

describe('groupServicesByPort', () => {
    const defaultPort = 5000

    it('puts bare names on the default port', () => {
        const result = groupServicesByPort(['ua.gov.diia.x.XPrivate', 'ua.gov.diia.x.XPublic'], defaultPort)

        expect(result).toEqual(new Map([[defaultPort, ['ua.gov.diia.x.XPrivate', 'ua.gov.diia.x.XPublic']]]))
    })

    it('keeps an empty default port', () => {
        const result = groupServicesByPort([{ name: 'ua.gov.diia.x.XPublic', port: 5001 }], defaultPort)

        expect([...result.entries()]).toEqual([
            [defaultPort, []],
            [5001, ['ua.gov.diia.x.XPublic']],
        ])
    })

    it('puts a service on both ports', () => {
        const result = groupServicesByPort(
            ['ua.gov.diia.x.XPrivate', 'ua.gov.diia.x.XPublic', { name: 'ua.gov.diia.x.XPublic', port: 5001 }],
            defaultPort,
        )

        expect([...result.entries()]).toEqual([
            [defaultPort, ['ua.gov.diia.x.XPrivate', 'ua.gov.diia.x.XPublic']],
            [5001, ['ua.gov.diia.x.XPublic']],
        ])
    })

    it('merges an entry for the default port', () => {
        const result = groupServicesByPort(['ua.gov.diia.x.XPrivate', { name: 'ua.gov.diia.x.XPublic', port: defaultPort }], defaultPort)

        expect(result).toEqual(new Map([[defaultPort, ['ua.gov.diia.x.XPrivate', 'ua.gov.diia.x.XPublic']]]))
    })

    it.each([
        ['empty name', ''],
        ['missing port', { name: 'ua.gov.diia.x.XPublic' }],
        ['string port', { name: 'ua.gov.diia.x.XPublic', port: '5001' }],
        ['port 0', { name: 'ua.gov.diia.x.XPublic', port: 0 }],
        ['port out of range', { name: 'ua.gov.diia.x.XPublic', port: 65536 }],
        ['fractional port', { name: 'ua.gov.diia.x.XPublic', port: 5001.5 }],
        ['missing name', { port: 5001 }],
        ['null', null],
    ])('rejects %s', (_, entry) => {
        expect(() => groupServicesByPort([entry as never], defaultPort)).toThrow(`Invalid grpc service entry ${JSON.stringify(entry)}`)
    })
})
