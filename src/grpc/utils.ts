import { Context, context } from '@opentelemetry/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bindAsyncGenerator<T = unknown, TReturn = any, TNext = unknown>(
    ctx: Context,
    generator: AsyncGenerator<T, void | TReturn, TNext>,
): AsyncGenerator<T, void | TReturn, TNext> {
    return {
        next: context.bind(ctx, generator.next.bind(generator)),
        return: context.bind(ctx, generator.return.bind(generator)),
        throw: context.bind(ctx, generator.throw.bind(generator)),

        [Symbol.asyncIterator](): AsyncGenerator<T, void | TReturn, TNext> {
            return bindAsyncGenerator(ctx, generator)
        },
    }
}
