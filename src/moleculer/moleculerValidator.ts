import { Validator } from 'moleculer'

import { AppValidator, ValidationSchema } from '@diia-inhouse/validators'

export default class MoleculerValidator extends Validator {
    constructor(private readonly validator: AppValidator) {
        super()
    }

    validate(params: unknown, schema: ValidationSchema): boolean {
        return this.validator.validate(params, schema)
    }
}
