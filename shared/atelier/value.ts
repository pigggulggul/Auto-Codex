import type { DeepReadonly } from './types.js';
/** Deep copy; callers explicitly choose when a frozen value becomes an editor copy. */
export function clone<T>(value: T): T {
    return structuredClone(value);
}
export function editable<T>(value: DeepReadonly<T>): T {
    return structuredClone(value) as T;
}
export function freeze<T>(value: T): DeepReadonly<T> {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value))
            freeze(child);
        Object.freeze(value);
    }
    return value as DeepReadonly<T>;
}

