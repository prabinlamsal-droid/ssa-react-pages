import { ssa } from './ssa.js';

/** Async access to explicitly allowed native Shelf keys shared with Flutter. */
export class Shelf {
  #storage;

  /** Uses the existing SSA client; callers may inject a client for tests. */
  constructor(client = ssa) {
    this.#storage = client.storage;
  }

  /** Saves a value matching the native key's type; resolves to null. */
  async put(key, value) {
    return this.#storage.set({ key, value });
  }

  /** Reads the native value, or the supplied fallback (null by default) if absent. */
  async get(key, defaultValue = null) {
    const value = await this.#storage.get({ key });
    return value === null ? defaultValue : value;
  }

  /** Deletes an allowed native key. Resolves to true if present, false if absent. */
  async delete(key) {
    return this.#storage.remove({ key });
  }

  /** Resolves to true if the shared key exists, including false or empty values. */
  async containsKey(key) {
    return this.#storage.containsKey({ key });
  }

  /** Clears allowed shared keys except protected ones. Resolves to null. */
  async deleteAll() {
    return this.#storage.deleteAll();
  }
}

/** Shared wrapper over the existing bridge client; creates no new transport. */
export const shelf = new Shelf();
