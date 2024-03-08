/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable no-underscore-dangle */
import { ObjectId } from 'bson'

import { ObjectIdCustomType } from './interfaces/actionJsonConvertor'

function isBsonType(elem: any): boolean {
    // eslint-disable-next-line no-prototype-builtins
    return elem?.hasOwnProperty('_bsontype')
}

function isObjectIDType(elem: any): boolean {
    return isBsonType(elem) && elem._bsontype === 'ObjectID'
}

function convertToObjectIdCustomType(elem: ObjectId): ObjectIdCustomType {
    return { $objectId: elem.toHexString() }
}

function convertModelToJson(obj: any): any {
    for (const k in obj) {
        if (obj[k] === null) {
            // eslint-disable-next-line no-continue
            continue
        } else if (isObjectIDType(obj[k])) {
            obj[k] = convertToObjectIdCustomType(obj[k])
        } else if (Array.isArray(obj[k])) {
            for (const elem in obj[k]) {
                if (isObjectIDType(obj[k][elem])) {
                    obj[k][elem] = convertToObjectIdCustomType(obj[k][elem])
                } else if (typeof obj[k][elem] === 'object') {
                    obj[k][elem] = convertModelToJson(obj[k][elem])
                }
            }
        } else if (typeof obj[k] === 'object' && obj[k] !== null) {
            obj[k] = convertModelToJson(obj[k])
        }
    }

    return obj
}

function convertObjectToJson(obj: any): unknown {
    let res: any
    if (obj && typeof obj._doc !== 'undefined' && typeof obj.toObject === 'function') {
        res = convertModelToJson(obj.toObject())
    } else {
        res = obj
    }

    if (isObjectIDType(res)) {
        return convertToObjectIdCustomType(res)
    }

    for (const k in res) {
        if (Array.isArray(res[k])) {
            res[k] = convertArrayToJson(res[k])
        } else if (typeof res[k] === 'object' && res[k] !== null) {
            if (typeof res[k]._doc !== 'undefined' && typeof res[k].toObject === 'function') {
                res[k] = convertModelToJson(res[k].toObject())
            } else if (isObjectIDType(res[k])) {
                res[k] = convertToObjectIdCustomType(res[k])
            } else if (!Buffer.isBuffer(res[k])) {
                res[k] = convertObjectToJson(res[k])
            }
        }
    }

    return res
}

export function actionTypesToJson(obj: unknown): unknown {
    if (!obj) {
        return obj
    }

    return convertObjectToJson(obj)
}

function convertArrayToJson(arr: any[]): any[] {
    const res: any = arr
    for (const elem in res) {
        if (isObjectIDType(res[elem])) {
            res[elem] = convertToObjectIdCustomType(res[elem])
        } else if (typeof res[elem] === 'object') {
            res[elem] = convertObjectToJson(res[elem])
        }
    }

    return res
}

function isObjectIdProperty(elem: unknown): elem is ObjectIdCustomType {
    // eslint-disable-next-line no-prototype-builtins
    return elem !== null && typeof elem === 'object' && elem.hasOwnProperty('$objectId')
}

function createNewObjectId(elem: ObjectIdCustomType): ObjectId {
    return new ObjectId(elem.$objectId)
}

function convertObjectJsonParse(obj: Record<string, any>): void {
    for (const k in obj) {
        if (Array.isArray(obj[k])) {
            convertArrayJsonParse(obj[k])
        } else if (isObjectIdProperty(obj[k])) {
            obj[k] = createNewObjectId(obj[k])
        } else if (typeof obj[k] === 'object' && obj[k] !== null) {
            convertObjectJsonParse(obj[k])
        }
    }
}

function convertArrayJsonParse(arr: any[]): void {
    for (const elem in arr) {
        if (isObjectIdProperty(arr[elem])) {
            arr[elem] = createNewObjectId(arr[elem])
        } else if (typeof arr[elem] === 'object') {
            convertObjectJsonParse(arr[elem])
        }
    }
}

export function actionTypesJsonParse(obj: Record<string, unknown> | undefined): Record<string, unknown> | ObjectId | undefined {
    if (!obj) {
        return obj
    }

    if (isObjectIdProperty(obj)) {
        return createNewObjectId(obj)
    }

    convertObjectJsonParse(obj)

    return obj
}
