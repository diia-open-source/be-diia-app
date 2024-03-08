import EventEmitter from 'events'

export interface PluginDepsCollection<T> extends EventEmitter {
    items: T[]
    addItems(items: T[]): void
    on(eventName: 'newItems', listener: (items: T[]) => void): this
}
