class ObjectIdMock {
    _bsontype = 'ObjectID'

    id: string

    constructor(id: string | ObjectIdMock) {
        this.id = id.toString()
    }

    toHexString(): string {
        return this.id
    }

    toString(): string {
        return this.id
    }
}

class Model {
    _doc: unknown

    constructor(doc: unknown) {
        // eslint-disable-next-line no-underscore-dangle
        this._doc = doc
    }

    toObject(): unknown {
        // eslint-disable-next-line no-underscore-dangle
        return this._doc
    }
}

jest.mock('bson', () => ({ ObjectId: ObjectIdMock }))

import { actionTypesJsonParse, actionTypesToJson } from '../../src'

describe('ActionJsonConvertor', () => {
    describe(`method ${actionTypesJsonParse.name}`, () => {
        const date = new Date()

        it.each([
            [
                'parse nested object',
                {
                    _id: new ObjectIdMock('63fda9ec38f6a88647048a2c'),
                    comments: [
                        { _id: new ObjectIdMock('63fdaae02b41e8e56916883e'), text: 'Hello', date },
                        { $objectId: new ObjectIdMock('63fdacaf2c8cc05cc972fda0'), text: 'Hi!', date },
                    ],
                    name: 'John',
                    info: {
                        $objectId: new ObjectIdMock('63fdad04e030b3a1fa0891c7'),
                    },
                },
                {
                    _id: new ObjectIdMock('63fda9ec38f6a88647048a2c'),
                    comments: [
                        { _id: new ObjectIdMock('63fdaae02b41e8e56916883e'), text: 'Hello', date },
                        new ObjectIdMock('63fdacaf2c8cc05cc972fda0'),
                    ],
                    name: 'John',
                    info: new ObjectIdMock('63fdad04e030b3a1fa0891c7'),
                },
            ],
            ['is object id', { $objectId: new ObjectIdMock('63fda9ec38f6a88647048a2c') }, new ObjectIdMock('63fda9ec38f6a88647048a2c')],
            ['is undefined', undefined, undefined],
        ])('should successfully parse types to json when %s', (_msg, input, expected) => {
            expect(actionTypesJsonParse(input)).toEqual(expected)
        })
    })

    describe(`method ${actionTypesToJson.name}`, () => {
        const date = new Date()

        it.each([
            ['is undefined', undefined, undefined],
            ['is object', { name: 'John' }, { name: 'John' }],
            ['is object id', new ObjectIdMock('63fda9ec38f6a88647048a2c'), { $objectId: '63fda9ec38f6a88647048a2c' }],
            [
                'is object with object id',
                { _id: new ObjectIdMock('63fda9ec38f6a88647048a2c') },
                { _id: { $objectId: '63fda9ec38f6a88647048a2c' } },
            ],
            [
                'is object with model',
                { name: 'John', doc: new Model({ _id: new ObjectIdMock('63fda9ec38f6a88647048a2c') }) },
                { name: 'John', doc: { _id: { $objectId: '63fda9ec38f6a88647048a2c' } } },
            ],
            [
                'is object with models list',
                {
                    total: 2,
                    items: [
                        new ObjectIdMock('63fda9ec38f6a88647048a2c'),
                        new Model({
                            _id: new ObjectIdMock('63fda9ec38f6a88647048a2c'),
                            comments: [
                                { _id: new ObjectIdMock('63fdaae02b41e8e56916883e'), text: 'Hello', date },
                                { _id: new ObjectIdMock('63fdacaf2c8cc05cc972fda0'), text: 'Hi!', date },
                                new ObjectIdMock('63fdbd8a0cba5e08d5f95713'),
                            ],
                            name: 'John',
                            docs: null,
                            info: {
                                _id: new ObjectIdMock('63fdad04e030b3a1fa0891c7'),
                            },
                        }),
                    ],
                },
                {
                    total: 2,
                    items: [
                        { $objectId: '63fda9ec38f6a88647048a2c' },
                        {
                            _id: { $objectId: '63fda9ec38f6a88647048a2c' },
                            comments: [
                                { _id: { $objectId: '63fdaae02b41e8e56916883e' }, text: 'Hello', date },
                                { _id: { $objectId: '63fdacaf2c8cc05cc972fda0' }, text: 'Hi!', date },
                                { $objectId: '63fdbd8a0cba5e08d5f95713' },
                            ],
                            name: 'John',
                            docs: null,
                            info: {
                                _id: { $objectId: '63fdad04e030b3a1fa0891c7' },
                            },
                        },
                    ],
                },
            ],
        ])('should successfully convert types to json when %s', (_msg, input, expected) => {
            expect(actionTypesToJson(input)).toEqual(expected)
        })
    })
})
