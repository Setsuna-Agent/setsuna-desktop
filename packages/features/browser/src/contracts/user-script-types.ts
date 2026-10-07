// Adapted from BenItBuhner/Zenium (Apache-2.0). See THIRD_PARTY_NOTICES.md.
export type UserScriptRunAt = 'document_start' | 'document_end' | 'document_idle'
export type UserScriptWorld = 'MAIN' | 'USER_SCRIPT'

/** One `js` entry: inline code, or a file relative to the extension root. */
export type UserScriptSource = { code: string } | { file: string }

/** A registration as `userScripts.getScripts` reports it (Chrome fills the defaults in). */
export interface RegisteredUserScript {
  id: string
  matches: string[]
  excludeMatches?: string[]
  includeGlobs?: string[]
  excludeGlobs?: string[]
  allFrames: boolean
  runAt: UserScriptRunAt
  world: UserScriptWorld
  /** Only for `USER_SCRIPT` scripts; absent means the extension's default user-script world. */
  worldId?: string
  js: UserScriptSource[]
}

/** `userScripts.configureWorld`: one user-script world's CSP and messaging switch. */
export interface UserScriptWorldConfig {
  /** Absent for the extension's default user-script world. */
  worldId?: string
  csp?: string
  messaging: boolean
}

/** Everything the host persists per extension. */
export interface UserScriptsState {
  scripts: RegisteredUserScript[]
  worlds: UserScriptWorldConfig[]
}
