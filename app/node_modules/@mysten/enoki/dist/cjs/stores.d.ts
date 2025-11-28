/**
 * An sync key-value store.
 */
export interface SyncStore {
    get(key: string): string | null;
    set(key: string, value: string): void;
    delete(key: string): void;
}
/**
 * Create a storage interface backed by memory.
 * This is generally useful for server-side rendering, and test environments.
 */
export declare function createInMemoryStorage(): SyncStore;
/**
 * Create a store backed by `localStorage`.
 */
export declare function createLocalStorage(): SyncStore;
/**
 * Create a store backed by `sessionStorage`.
 */
export declare function createSessionStorage(): SyncStore;
