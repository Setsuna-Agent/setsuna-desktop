// Adapted from BenItBuhner/Zenium (Apache-2.0). See THIRD_PARTY_NOTICES.md.
/**
 * The `chrome.*` surface of a `USER_SCRIPT` world: what Chrome gives user scripts running in an
 * extension's isolated world, built by the page preload before the world's first script runs.
 * Only messaging exists there – `runtime.sendMessage` / `runtime.connect` to the extension (its
 * `runtime.onUserScriptMessage` / `onUserScriptConnect`), `runtime.onMessage` for what the
 * extension sends the world with `tabs.sendMessage` – plus the identity bits (`runtime.id`,
 * `runtime.getURL`, `extension.inIncognitoContext`).
 *
 * The world talks to the preload (Electron's context-isolation world, in the same document)
 * through `CustomEvent`s on `document` under two random names the preload picked for this
 * document, with JSON-string payloads: primitives cross isolated worlds, objects do not.
 *
 * `installUserScriptWorldApi` is one self-contained function with no free variables besides
 * globals: the preload stringifies it into the world (`webFrame.executeJavaScriptInIsolatedWorld`),
 * which is why the two names it shares with the preload are spelled out inside it as well.
 */

export interface WorldApiConfig {
  extensionId: string
  /** `chrome.extension.inIncognitoContext`: the document is in a private window. */
  incognito: boolean
  /** `userScripts.configureWorld({ messaging })`: whether the world gets messaging APIs. */
  messaging: boolean
  /** `CustomEvent` type names on `document`: preload → world, and world → preload. */
  inbound: string
  outbound: string
}

/** What the world sends the preload (JSON in the event's `detail`). */
export type WorldToPreload =
  | { kind: 'message'; id: number; message: unknown }
  | { kind: 'connect'; portId: string; name: string }
  | { kind: 'port-message'; portId: string; message: unknown }
  | { kind: 'port-disconnect'; portId: string }
  /**
   * The answer to a `deliver`: `handled` false when no `runtime.onMessage` listener exists,
   * `responded` false when the listeners let the channel close without `sendResponse`.
   */
  | { kind: 'response'; token: number; handled: boolean; responded: boolean; result?: unknown }

/** What the preload sends the world. */
export type PreloadToWorld =
  | { kind: 'response'; id: number; result?: unknown; error?: string }
  | { kind: 'port-message'; portId: string; message: unknown }
  | { kind: 'port-disconnect'; portId: string; error?: string }
  /** A `tabs.sendMessage` from the extension: `runtime.onMessage(message, sender, sendResponse)`. */
  | { kind: 'deliver'; token: number; message: unknown; sender: unknown }

/**
 * The name of the evaluator the world API installs for `userScripts.execute` (see
 * `preload/userScripts.ts`); `installUserScriptWorldApi` repeats the literal.
 */
export const WORLD_EVALUATOR = '__setsunaUserScriptEval'

/** The shape `WORLD_EVALUATOR` answers with: the last expression's value, or the error's message. */
export interface WorldEvalResult {
  value?: unknown
  error?: string
  /** The world's CSP forbids `eval`: the caller runs the code plainly instead. */
  noEval?: true
}

/** Chrome's error for a message nobody listens to (repeated inside the installer). */
export const WORLD_NO_RECEIVER_ERROR =
  'Could not establish connection. Receiving end does not exist.'

export const DISCONNECTED_PORT_ERROR = 'Attempting to use a disconnected port object'

export function installUserScriptWorldApi(config: WorldApiConfig, root?: object): void {
  // The isolated world's Chromium globals have no extension API declarations.
  type Any = any
  const g: Any = root ?? globalThis
  const doc: Document = g.document ?? document
  // The literals `WORLD_NO_RECEIVER_ERROR`, `DISCONNECTED_PORT_ERROR` and `WORLD_EVALUATOR`
  // stand for: this function is serialised into the world and can reach no module binding.
  const NO_RECEIVER = 'Could not establish connection. Receiving end does not exist.'
  const DISCONNECTED = 'Attempting to use a disconnected port object'
  const EVALUATOR = '__setsunaUserScriptEval'
  type Listener = (...args: unknown[]) => unknown

  function post(payload: WorldToPreload): void {
    try {
      doc.dispatchEvent(new CustomEvent(config.outbound, { detail: JSON.stringify(payload) }))
    } catch {
      /* the document is going away, or the payload cannot be serialised */
    }
  }

  interface WorldEvent {
    addListener(fn: unknown): void
    removeListener(fn: unknown): void
    hasListener(fn: unknown): boolean
    hasListeners(): boolean
    listeners(): Listener[]
  }

  function makeEvent(): WorldEvent {
    const set = new Set<Listener>()
    return {
      addListener(fn: unknown): void {
        if (typeof fn === 'function') set.add(fn as Listener)
      },
      removeListener(fn: unknown): void {
        set.delete(fn as Listener)
      },
      hasListener(fn: unknown): boolean {
        return set.has(fn as Listener)
      },
      hasListeners(): boolean {
        return set.size > 0
      },
      listeners(): Listener[] {
        return [...set]
      }
    }
  }

  function rethrow(error: unknown): void {
    setTimeout(() => {
      throw error
    }, 0)
  }

  function isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      typeof (value as { then?: unknown }).then === 'function'
    )
  }

  const runtime: Any = {}
  const extensionUrl = `chrome-extension://${config.extensionId}/`
  Object.defineProperty(runtime, 'id', { value: config.extensionId, enumerable: true })

  // `runtime.lastError` exists only while an error callback runs, as in Chrome; a callback that
  // never reads it gets Chrome's "Unchecked runtime.lastError" console line.
  let lastError: { message: string } | undefined
  Object.defineProperty(runtime, 'lastError', {
    get: () => lastError,
    configurable: true,
    enumerable: true
  })
  function withLastError(message: string, fn: () => void): void {
    const error = { message }
    let checked = false
    lastError = error
    Object.defineProperty(runtime, 'lastError', {
      get: () => {
        checked = true
        return error
      },
      configurable: true,
      enumerable: true
    })
    try {
      fn()
    } finally {
      lastError = undefined
      Object.defineProperty(runtime, 'lastError', {
        get: () => lastError,
        configurable: true,
        enumerable: true
      })
      if (!checked) {
        try {
          console.error(`Unchecked runtime.lastError: ${message}`)
        } catch {
          /* no console */
        }
      }
    }
  }

  runtime.getURL = (path: unknown): string => extensionUrl + String(path ?? '').replace(/^\/+/, '')
  runtime.getPlatformInfo = (callback?: unknown): Promise<unknown> | undefined => {
    const ua = String(g.navigator?.userAgent ?? '')
    const os = /Windows/.test(ua)
      ? 'win'
      : /Mac OS/.test(ua)
        ? 'mac'
        : /Android/.test(ua)
          ? 'android'
          : /CrOS/.test(ua)
            ? 'cros'
            : /Linux/.test(ua)
              ? 'linux'
              : 'openbsd'
    const info = { os, arch: 'x86-64', nacl_arch: 'x86-64' }
    if (typeof callback === 'function') {
      callback(info)
      return undefined
    }
    return Promise.resolve(info)
  }

  // ---------------------------------------------------------------------------
  // runtime.onMessage: what `tabs.sendMessage` delivers to the world
  // ---------------------------------------------------------------------------

  const onMessage = makeEvent()
  if (config.messaging) {
    runtime.onMessage = onMessage
    // `tabs.connect` does not reach user-script worlds here; the event exists so scripts can register.
    runtime.onConnect = makeEvent()
  }

  function deliver(token: number, message: unknown, sender: unknown): void {
    const listeners = onMessage.listeners()
    if (listeners.length === 0) {
      post({ kind: 'response', token, handled: false, responded: false })
      return
    }
    let answered = false
    const sendResponse = (result?: unknown): void => {
      if (answered) return
      answered = true
      post({ kind: 'response', token, handled: true, responded: true, result })
    }
    let waiting = false
    for (const fn of listeners) {
      try {
        const result = fn(message, sender, sendResponse)
        if (result === true) waiting = true
        else if (isThenable(result)) {
          waiting = true
          result.then(sendResponse, (error: unknown) => {
            if (!answered) {
              answered = true
              post({ kind: 'response', token, handled: true, responded: false })
            }
            rethrow(error)
          })
        }
      } catch (error) {
        rethrow(error)
      }
    }
    // Nobody kept the channel open: Chrome closes the port, and the sender hears "the message
    // port closed before a response was received".
    if (!waiting && !answered) {
      answered = true
      post({ kind: 'response', token, handled: true, responded: false })
    }
  }

  // ---------------------------------------------------------------------------
  // runtime.sendMessage / runtime.connect: the world's side of the extension's messaging
  // ---------------------------------------------------------------------------

  let messageIds = 0
  const pendingMessages = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()

  interface PortRecord {
    port: Any
    connected: boolean
    onMessage: WorldEvent
    onDisconnect: WorldEvent
  }
  const ports = new Map<string, PortRecord>()
  let portIds = 0
  const portPrefix = Math.random().toString(36).slice(2)

  /** Chrome's `sendMessage(extensionId?, message, options?, callback?)` argument matching. */
  function messageArgs(raw: unknown[]): {
    extensionId: string | null
    message: unknown
    callback: ((...args: unknown[]) => void) | undefined
  } {
    const args = [...raw]
    const callback =
      args.length > 0 && typeof args[args.length - 1] === 'function'
        ? (args.pop() as (...args: unknown[]) => void)
        : undefined
    if (args.length >= 2 && (typeof args[0] === 'string' || args[0] === null)) {
      return { extensionId: (args[0] as string | null) ?? null, message: args[1], callback }
    }
    return { extensionId: null, message: args[0], callback }
  }

  function settle(
    promise: Promise<unknown>,
    callback: ((...args: unknown[]) => void) | undefined
  ): Promise<unknown> | undefined {
    if (!callback) return promise
    promise.then(
      (value) => {
        try {
          callback(value)
        } catch (error) {
          rethrow(error)
        }
      },
      (error: unknown) => {
        withLastError(error instanceof Error ? error.message : String(error), () => {
          try {
            callback()
          } catch (thrown) {
            rethrow(thrown)
          }
        })
      }
    )
    return undefined
  }

  function disconnectPort(portId: string, error: string | undefined): void {
    const record = ports.get(portId)
    if (!record) return
    ports.delete(portId)
    record.connected = false
    const fire = (): void => {
      for (const fn of record.onDisconnect.listeners()) {
        try {
          fn(record.port)
        } catch (thrown) {
          rethrow(thrown)
        }
      }
    }
    if (error) withLastError(error, fire)
    else fire()
  }

  if (config.messaging) {
    runtime.sendMessage = function (...raw: unknown[]): Promise<unknown> | undefined {
      const { extensionId, message, callback } = messageArgs(raw)
      if (raw.length === 0 || message === undefined) {
        throw new TypeError(
          'Error in invocation of runtime.sendMessage(optional string extensionId, any message, optional object options, optional function callback): No matching signature.'
        )
      }
      if (extensionId !== null && extensionId !== config.extensionId) {
        return settle(Promise.reject(new Error(NO_RECEIVER)), callback)
      }
      messageIds += 1
      const id = messageIds
      const promise = new Promise<unknown>((resolve, reject) => {
        pendingMessages.set(id, { resolve, reject })
      })
      post({ kind: 'message', id, message })
      return settle(promise, callback)
    }

    runtime.connect = function (...raw: unknown[]): Any {
      let connectInfo: unknown = raw[0]
      let extensionId: string | null = null
      if (typeof raw[0] === 'string' || raw[0] === null) {
        extensionId = raw[0] as string | null
        connectInfo = raw[1]
      }
      const name =
        connectInfo !== null && typeof connectInfo === 'object'
          ? String((connectInfo as { name?: unknown }).name ?? '')
          : ''
      portIds += 1
      const portId = `${portPrefix}:${portIds}`
      const record: PortRecord = {
        port: null,
        connected: true,
        onMessage: makeEvent(),
        onDisconnect: makeEvent()
      }
      const port: Any = {
        name,
        onMessage: record.onMessage,
        onDisconnect: record.onDisconnect,
        postMessage(message: unknown): void {
          if (!record.connected) throw new Error(DISCONNECTED)
          if (message === undefined) {
            throw new TypeError(
              'Error in invocation of runtime.Port.postMessage(any message): No matching signature.'
            )
          }
          post({ kind: 'port-message', portId, message })
        },
        disconnect(): void {
          if (!record.connected) return
          record.connected = false
          ports.delete(portId)
          post({ kind: 'port-disconnect', portId })
        }
      }
      record.port = port
      ports.set(portId, record)
      if (extensionId !== null && extensionId !== config.extensionId) {
        // Nobody at the other end: the port disconnects on its own, with the error.
        setTimeout(() => disconnectPort(portId, NO_RECEIVER), 0)
      } else {
        post({ kind: 'connect', portId, name })
      }
      return port
    }
  }

  function receive(payload: PreloadToWorld): void {
    switch (payload.kind) {
      case 'response': {
        const pending = pendingMessages.get(payload.id)
        if (!pending) return
        pendingMessages.delete(payload.id)
        if (payload.error !== undefined) pending.reject(new Error(payload.error))
        else pending.resolve(payload.result)
        return
      }
      case 'port-message': {
        const record = ports.get(payload.portId)
        if (!record) return
        for (const fn of record.onMessage.listeners()) {
          try {
            fn(payload.message, record.port)
          } catch (thrown) {
            rethrow(thrown)
          }
        }
        return
      }
      case 'port-disconnect':
        disconnectPort(payload.portId, payload.error)
        return
      case 'deliver':
        if (config.messaging) deliver(payload.token, payload.message, payload.sender)
        return
    }
  }

  doc.addEventListener(config.inbound, (event: Event) => {
    const detail: unknown = (event as CustomEvent).detail
    if (typeof detail !== 'string') return
    let payload: unknown
    try {
      payload = JSON.parse(detail)
    } catch {
      return
    }
    if (payload !== null && typeof payload === 'object' && 'kind' in payload) {
      receive(payload as PreloadToWorld)
    }
  })

  // ---------------------------------------------------------------------------
  // The objects
  // ---------------------------------------------------------------------------

  const extension: Any = {
    inIncognitoContext: config.incognito,
    getURL: runtime.getURL
  }
  const chrome: Any = { runtime, extension }
  for (const name of ['chrome', 'browser']) {
    try {
      Object.defineProperty(g, name, { value: chrome, configurable: true, writable: true })
    } catch {
      g[name] = chrome
    }
  }

  /**
   * `userScripts.execute` runs code through this so a thrown error comes back as the injection's
   * `error` (an isolated world's exceptions never reach the preload). A world whose CSP forbids
   * `eval` says so, and the preload runs the code plainly.
   */
  Object.defineProperty(g, EVALUATOR, {
    value: (code: string): WorldEvalResult => {
      try {
        // Indirect eval: global scope, like a script of the world.
        return { value: (0, eval)(code) }
      } catch (error) {
        if (
          error instanceof EvalError ||
          (error instanceof Error && /unsafe-eval|Content Security Policy/i.test(error.message))
        ) {
          return { noEval: true }
        }
        return {
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        }
      }
    },
    configurable: true,
    enumerable: false,
    writable: false
  })
}
