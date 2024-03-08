import EventEmitter from 'events'

export default class PluginDepsCollection<T> extends EventEmitter {
    readonly items: T[] = []

    addItems(items: T[]): void {
        this.items.push(...items)
        this.emit('newItems', items)
    }
}
