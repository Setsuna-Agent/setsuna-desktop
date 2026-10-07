// Adapted from BenItBuhner/Zenium (Apache-2.0). See THIRD_PARTY_NOTICES.md.
/**
 * `chrome.userScripts` for the browser layer: what a host keeps of an extension's registered
 * user scripts and world configurations, Chrome's validation of the arguments, and the plan of
 * what to inject into one frame. Pure data and functions: the desktop host persists the state
 * and runs the plan through the page preload (`preload/userScripts.ts`), and answers the API
 * calls through the browser feature's narrow extension IPC bridge.
 *
 * Chrome gates the whole namespace behind a per-extension "Allow user scripts" toggle
 * (`ExtensionInfo.allowUserScripts`): with it off, `chrome.userScripts` throws on access and
 * registered scripts stay registered but never run.
 */
import { compileMatchPattern, contentScriptAppliesTo } from './match-pattern.js'

import type { RegisteredUserScript, UserScriptRunAt, UserScriptWorld, UserScriptSource, UserScriptWorldConfig, UserScriptsState } from '../../../contracts/user-script-types.js'
export function emptyUserScriptsState(): UserScriptsState {
  return { scripts: [], worlds: [] }
}

/** What accessing `chrome.userScripts` throws while the extension's toggle is off. */
export const USER_SCRIPTS_UNAVAILABLE_ERROR =
  "The 'userScripts' API is only available when 'Allow user scripts' is turned on for this extension."

/** A call that reached the host while the toggle is off (it was turned off after the page loaded). */
export function userScriptsMethodUnavailable(method: string): string {
  return `'userScripts.${method}' is not available.`
}

/** Chrome's default CSP of a content-script world (MV3 default CSP), the user-script default too. */
export const DEFAULT_USER_SCRIPT_CSP = "script-src 'self'; object-src 'self'"

const RUN_AT: readonly UserScriptRunAt[] = ['document_start', 'document_end', 'document_idle']
const WORLDS: readonly UserScriptWorld[] = ['MAIN', 'USER_SCRIPT']

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringList(value: unknown, what: string, id: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Script with ID '${id}' has an invalid '${what}'.`)
  for (const item of value) {
    if (typeof item !== 'string')
      throw new Error(`Script with ID '${id}' has an invalid '${what}': expected strings.`)
  }
  return value as string[]
}

function checkPatterns(patterns: string[], what: string, id: string): void {
  for (const pattern of patterns) {
    if (compileMatchPattern(pattern) === null)
      throw new Error(`Script with ID '${id}' has an invalid ${what} pattern: '${pattern}'.`)
  }
}

function checkWorldId(worldId: string): void {
  if (worldId === '') throw new Error("If specified, 'worldId' must be non-empty.")
  if (worldId.startsWith('_')) throw new Error("World IDs beginning with '_' are reserved.")
}

function sources(value: unknown, id: string): UserScriptSource[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`Script with ID '${id}' must specify at least one js source.`)
  return value.map((item: unknown): UserScriptSource => {
    if (!isRecord(item)) throw new Error(`Script with ID '${id}' has an invalid js source.`)
    const hasCode = typeof item.code === 'string'
    const hasFile = typeof item.file === 'string'
    if (hasCode === hasFile) {
      throw new Error(
        `Script with ID '${id}' must specify exactly one of 'code' or 'file' as a js source.`
      )
    }
    return hasCode
      ? { code: item.code as string }
      : { file: (item.file as string).replace(/^\/+/, '') }
  })
}

function scriptId(item: Record<string, unknown>): string {
  const id = item.id
  if (typeof id !== 'string' || id === '') throw new Error("Script's ID must not be empty.")
  if (id.startsWith('_')) throw new Error(`Script's ID '${id}' must not start with '_'.`)
  return id
}

function scriptsArray(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) throw new TypeError("Error at parameter 'scripts': expected array.")
  return raw.map((item: unknown, index: number) => {
    if (!isRecord(item))
      throw new TypeError(`Error at parameter 'scripts': Error at index ${index}: expected object.`)
    return item
  })
}

/**
 * `userScripts.register(scripts)`: the registrations, validated and filled with Chrome's
 * defaults (`allFrames` false, `runAt` document_idle, `world` USER_SCRIPT). `existingIds` are
 * the ids already registered; a repeat is an error, as within one call.
 */
export function normalizeRegistrations(
  raw: unknown,
  existingIds: ReadonlySet<string>
): RegisteredUserScript[] {
  const seen = new Set<string>()
  return scriptsArray(raw).map((item): RegisteredUserScript => {
    const id = scriptId(item)
    if (seen.has(id) || existingIds.has(id)) throw new Error(`Duplicate script ID '${id}'`)
    seen.add(id)
    if (!Array.isArray(item.matches) || item.matches.length === 0)
      throw new Error(`Script with ID '${id}' must specify 'matches'.`)
    const script: RegisteredUserScript = {
      id,
      matches: stringList(item.matches, 'matches', id),
      allFrames: false,
      runAt: 'document_idle',
      world: 'USER_SCRIPT',
      js: sources(item.js, id)
    }
    checkPatterns(script.matches, 'match', id)
    applyOptional(script, item)
    return script
  })
}

/** Reads the optional fields of a registration or an update into `script`, validating each. */
function applyOptional(script: RegisteredUserScript, item: Record<string, unknown>): void {
  const id = script.id
  if (item.excludeMatches !== undefined) {
    script.excludeMatches = stringList(item.excludeMatches, 'excludeMatches', id)
    checkPatterns(script.excludeMatches, 'exclude match', id)
  }
  if (item.includeGlobs !== undefined)
    script.includeGlobs = stringList(item.includeGlobs, 'includeGlobs', id)
  if (item.excludeGlobs !== undefined)
    script.excludeGlobs = stringList(item.excludeGlobs, 'excludeGlobs', id)
  if (item.allFrames !== undefined) {
    if (typeof item.allFrames !== 'boolean')
      throw new Error(`Script with ID '${id}' has an invalid 'allFrames'.`)
    script.allFrames = item.allFrames
  }
  if (item.runAt !== undefined) {
    if (!RUN_AT.includes(item.runAt as UserScriptRunAt))
      throw new Error(`Script with ID '${id}' has an invalid 'runAt': '${String(item.runAt)}'.`)
    script.runAt = item.runAt as UserScriptRunAt
  }
  if (item.world !== undefined) {
    if (!WORLDS.includes(item.world as UserScriptWorld))
      throw new Error(`Script with ID '${id}' has an invalid 'world': '${String(item.world)}'.`)
    script.world = item.world as UserScriptWorld
  }
  if (item.worldId !== undefined) {
    if (typeof item.worldId !== 'string')
      throw new Error(`Script with ID '${id}' has an invalid 'worldId'.`)
    checkWorldId(item.worldId)
    script.worldId = item.worldId
  }
  if (script.worldId !== undefined && script.world !== 'USER_SCRIPT') {
    throw new Error(
      `Script with ID '${id}' specifies a world ID, but is not in the USER_SCRIPT world.`
    )
  }
}

/**
 * `userScripts.update(scripts)`: each entry names a registered script and replaces the
 * properties it carries (`matches` and `js` when given must still be non-empty); the others
 * keep their values. Returns the new list, in the original order.
 */
export function applyUpdates(
  existing: readonly RegisteredUserScript[],
  raw: unknown
): RegisteredUserScript[] {
  const byId = new Map(existing.map((script) => [script.id, { ...script }]))
  const seen = new Set<string>()
  for (const item of scriptsArray(raw)) {
    const id = scriptId(item)
    if (seen.has(id)) throw new Error(`Duplicate script ID '${id}'`)
    seen.add(id)
    const current = byId.get(id)
    if (!current) throw new Error(`Nonexistent script ID '${id}'`)
    const next: RegisteredUserScript = { ...current }
    if (item.matches !== undefined) {
      if (!Array.isArray(item.matches) || item.matches.length === 0)
        throw new Error(`Script with ID '${id}' must specify 'matches'.`)
      next.matches = stringList(item.matches, 'matches', id)
      checkPatterns(next.matches, 'match', id)
    }
    if (item.js !== undefined) next.js = sources(item.js, id)
    applyOptional(next, item)
    byId.set(id, next)
  }
  return existing.map((script) => byId.get(script.id) ?? script)
}

/** `userScripts.getScripts(filter)` / `unregister(filter)`: the scripts a filter selects. */
export function selectScripts(
  scripts: readonly RegisteredUserScript[],
  filter: unknown
): RegisteredUserScript[] {
  if (filter === undefined || filter === null) return [...scripts]
  if (!isRecord(filter)) throw new TypeError("Error at parameter 'filter': expected object.")
  if (filter.ids === undefined) return [...scripts]
  if (!Array.isArray(filter.ids) || !filter.ids.every((id) => typeof id === 'string'))
    throw new TypeError("Error at parameter 'filter': Error at property 'ids': expected strings.")
  const wanted = new Set(filter.ids as string[])
  return scripts.filter((script) => wanted.has(script.id))
}

/**
 * `userScripts.configureWorld(properties)`: the configuration replaces whatever the world had
 * (an unspecified `csp` returns to the default, `messaging` to false), as Chrome's does.
 */
export function normalizeWorldConfig(raw: unknown): UserScriptWorldConfig {
  if (!isRecord(raw)) throw new TypeError("Error at parameter 'properties': expected object.")
  const config: UserScriptWorldConfig = { messaging: raw.messaging === true }
  if (raw.messaging !== undefined && typeof raw.messaging !== 'boolean')
    throw new TypeError("Error at parameter 'properties': 'messaging' must be a boolean.")
  if (raw.csp !== undefined) {
    if (typeof raw.csp !== 'string')
      throw new TypeError("Error at parameter 'properties': 'csp' must be a string.")
    config.csp = raw.csp
  }
  if (raw.worldId !== undefined) {
    if (typeof raw.worldId !== 'string')
      throw new TypeError("Error at parameter 'properties': 'worldId' must be a string.")
    checkWorldId(raw.worldId)
    config.worldId = raw.worldId
  }
  return config
}

/** The configured worlds with `config` replacing the one of the same id (or the default world). */
export function setWorldConfig(
  worlds: readonly UserScriptWorldConfig[],
  config: UserScriptWorldConfig
): UserScriptWorldConfig[] {
  const rest = worlds.filter((world) => world.worldId !== config.worldId)
  return [...rest, config]
}

/** `userScripts.resetWorldConfiguration(worldId)`: the worlds without that one. */
export function resetWorldConfig(
  worlds: readonly UserScriptWorldConfig[],
  worldId: unknown
): UserScriptWorldConfig[] {
  if (worldId !== undefined && worldId !== null) {
    if (typeof worldId !== 'string')
      throw new TypeError("Error at parameter 'worldId': expected string.")
    checkWorldId(worldId)
  }
  const target = typeof worldId === 'string' ? worldId : undefined
  return worlds.filter((world) => world.worldId !== target)
}

/** The configuration of one world, or Chrome's defaults when it was never configured. */
export function worldConfigFor(
  worlds: readonly UserScriptWorldConfig[],
  worldId: string | undefined
): UserScriptWorldConfig {
  return worlds.find((world) => world.worldId === worldId) ?? { messaging: false }
}

// ---------------------------------------------------------------------------
// Injection planning
// ---------------------------------------------------------------------------

export interface UserScriptFrame {
  url: string
  isTopFrame: boolean
}

export interface PlanOptions {
  /** Whether the extension may run scripts on this URL (a granted host permission). */
  hostAccess(url: string): boolean
  /** Chrome's "Allow access to file URLs" toggle: `file:` pages get nothing without it. */
  allowFileAccess: boolean
}

/** One script of a world's plan, in registration order. */
export interface PlannedScript {
  id: string
  runAt: UserScriptRunAt
  js: UserScriptSource[]
}

/**
 * The scripts one extension world gets in a frame: every `USER_SCRIPT` registration sharing a
 * `worldId` (or none) runs in one isolated world with that world's CSP and messaging switch;
 * `MAIN` scripts run in the page's own world (`csp` and `messaging` are meaningless there).
 */
export interface WorldPlan {
  world: UserScriptWorld
  worldId: string | null
  /** The world's CSP; null for `MAIN`. */
  csp: string | null
  messaging: boolean
  scripts: PlannedScript[]
}

/**
 * What one extension injects into one frame: nothing when the extension's toggle is off, the
 * URL is outside its host permissions, or no registration matches. The host resolves `file`
 * sources to code before handing the plan to the page.
 */
export function planUserScripts(
  state: UserScriptsState,
  allowUserScripts: boolean,
  frame: UserScriptFrame,
  options: PlanOptions
): WorldPlan[] {
  if (!allowUserScripts || state.scripts.length === 0) return []
  if (!/^(https?|file|ftp|wss?):/i.test(frame.url)) return []
  if (frame.url.startsWith('file:') && !options.allowFileAccess) return []
  if (!options.hostAccess(frame.url)) return []
  const plans = new Map<string, WorldPlan>()
  for (const script of state.scripts) {
    if (
      !contentScriptAppliesTo(script, {
        url: frame.url,
        isTopFrame: frame.isTopFrame,
        precursorUrl: null
      })
    )
      continue
    const key = script.world === 'MAIN' ? 'MAIN' : `USER_SCRIPT:${script.worldId ?? ''}`
    let plan = plans.get(key)
    if (!plan) {
      const config = script.world === 'MAIN' ? null : worldConfigFor(state.worlds, script.worldId)
      plan = {
        world: script.world,
        worldId: script.world === 'MAIN' ? null : (script.worldId ?? null),
        csp: config ? (config.csp ?? DEFAULT_USER_SCRIPT_CSP) : null,
        messaging: config?.messaging ?? false,
        scripts: []
      }
      plans.set(key, plan)
    }
    plan.scripts.push({ id: script.id, runAt: script.runAt, js: script.js })
  }
  return [...plans.values()]
}

// ---------------------------------------------------------------------------
// `userScripts.execute`
// ---------------------------------------------------------------------------

export interface UserScriptInjection {
  js: UserScriptSource[]
  world: UserScriptWorld
  worldId?: string
  injectImmediately: boolean
  target: {
    tabId: number
    frameIds?: number[]
    documentIds?: string[]
    allFrames: boolean
  }
}

/** `userScripts.execute(injection)`: the injection, validated like Chrome's `scripting.executeScript`. */
export function normalizeInjection(raw: unknown): UserScriptInjection {
  if (!isRecord(raw)) throw new TypeError("Error at parameter 'injection': expected object.")
  const target = raw.target
  if (!isRecord(target) || typeof target.tabId !== 'number' || !Number.isInteger(target.tabId))
    throw new TypeError("Error at parameter 'injection': 'target.tabId' must be an integer.")
  const out: UserScriptInjection = {
    js: sources(raw.js, '_execute'),
    world: 'USER_SCRIPT',
    injectImmediately: raw.injectImmediately === true,
    target: { tabId: target.tabId, allFrames: target.allFrames === true }
  }
  if (raw.world !== undefined) {
    if (!WORLDS.includes(raw.world as UserScriptWorld))
      throw new Error(`Invalid 'world': '${String(raw.world)}'.`)
    out.world = raw.world as UserScriptWorld
  }
  if (raw.worldId !== undefined) {
    if (typeof raw.worldId !== 'string') throw new TypeError("'worldId' must be a string.")
    checkWorldId(raw.worldId)
    if (out.world !== 'USER_SCRIPT')
      throw new Error('A world ID can only be specified for the USER_SCRIPT world.')
    out.worldId = raw.worldId
  }
  if (target.frameIds !== undefined) {
    if (!Array.isArray(target.frameIds) || !target.frameIds.every(Number.isInteger))
      throw new TypeError("'target.frameIds' must be integers.")
    if (out.target.allFrames)
      throw new Error("Cannot specify 'allFrames' if 'frameIds' is specified.")
    out.target.frameIds = target.frameIds as number[]
  }
  if (target.documentIds !== undefined) {
    if (
      !Array.isArray(target.documentIds) ||
      !target.documentIds.every((d) => typeof d === 'string')
    )
      throw new TypeError("'target.documentIds' must be strings.")
    if (out.target.frameIds) throw new Error("Cannot specify both 'frameIds' and 'documentIds'.")
    if (out.target.allFrames)
      throw new Error("Cannot specify 'allFrames' if 'documentIds' is specified.")
    out.target.documentIds = target.documentIds as string[]
  }
  return out
}

/** A persisted document, or an empty state when it is not one (a rewrite then seeds it). */
export function parseUserScriptsState(text: string): UserScriptsState {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return emptyUserScriptsState()
  }
  return userScriptsStateFrom(parsed)
}

/** The persisted shape (`serializeUserScriptsState`), for stores that keep parsed JSON. */
export interface PersistedUserScripts {
  version: 1
  scripts: RegisteredUserScript[]
  worlds: UserScriptWorldConfig[]
}

export function persistedUserScripts(state: UserScriptsState): PersistedUserScripts {
  return { version: 1, scripts: state.scripts, worlds: state.worlds }
}

/** A parsed persisted document, validated entry by entry; anything else is an empty state. */
export function userScriptsStateFrom(parsed: unknown): UserScriptsState {
  if (!isRecord(parsed) || parsed.version !== 1) return emptyUserScriptsState()
  const state = emptyUserScriptsState()
  if (Array.isArray(parsed.scripts)) {
    try {
      state.scripts = normalizeRegistrations(parsed.scripts, new Set())
    } catch {
      state.scripts = []
    }
  }
  if (Array.isArray(parsed.worlds)) {
    for (const world of parsed.worlds) {
      try {
        state.worlds = setWorldConfig(state.worlds, normalizeWorldConfig(world))
      } catch {
        /* a malformed world entry is dropped */
      }
    }
  }
  return state
}

export function serializeUserScriptsState(state: UserScriptsState): string {
  return JSON.stringify(persistedUserScripts(state))
}
