import type { LoadConfigResult } from '@bamboocss/types'

/**
 * How each config was prepared, so that reading it again — once it has been edited — prepares it
 * the same way.
 *
 * An integration does more than read the file: it adds the Vue, Svelte and Astro parsers, marks a
 * dev server's build as one, keeps the `cwd` it was handed, and lays its own `config` over the
 * file's. A reload that only read the file again dropped all of that from the context it built: a
 * `.vue` file stopped reaching the sheet after the first edit to the config, and `hash: 'auto'`
 * changed every class name the browser already held.
 *
 * Kept apart from where it is filled, so the diff engine can ask without importing what creates
 * the contexts it refreshes.
 */
const reloaders = new WeakMap<LoadConfigResult, () => Promise<LoadConfigResult>>()

export const rememberConfigReload = (conf: LoadConfigResult, reload: () => Promise<LoadConfigResult>) => {
  reloaders.set(conf, reload)
}

export const configReloadOf = (conf: LoadConfigResult) => reloaders.get(conf)

/**
 * A copy of what is laid over a config, for the next read to lay over in turn.
 *
 * Down through its arrays and plain objects, property by property as each is defined — a getter
 * stays a getter, and is not called; frozen stays frozen. Anything else, a function, a `Map` or
 * any other instance, is the same value. An object met twice is copied once, so a value that
 * refers to itself refers to its copy. One that cannot be read through — a revoked proxy — is
 * laid over as it is, as it was before there was a copy.
 */
export const copyLaidOver = <T>(value: T): T => {
  try {
    return copyThrough(value, new WeakMap())
  } catch {
    return value
  }
}

const copyThrough = <T>(value: T, copies: WeakMap<object, unknown>): T => {
  if (value === null || typeof value !== 'object') return value
  if (copies.has(value)) return copies.get(value) as T
  const prototype = Object.getPrototypeOf(value)
  const array = Array.isArray(value) && prototype === Array.prototype
  // Plain in whichever realm made it: its prototype is that realm's `Object.prototype`, or none.
  if (!array && prototype !== null && Object.getPrototypeOf(prototype) !== null) return value
  const result = array ? new Array((value as unknown[]).length) : Object.create(prototype)
  copies.set(value, result)
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (!property) continue
    if ('value' in property) property.value = copyThrough(property.value, copies)
    Object.defineProperty(result, key, property)
  }
  if (!Object.isExtensible(value)) Object.preventExtensions(result)
  return result
}
