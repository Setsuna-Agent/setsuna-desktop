// Adapted from BenItBuhner/Zenium (Apache-2.0). See THIRD_PARTY_NOTICES.md.
import type { UserScriptRunAt } from '../contracts/user-script-types.js'
import {
  NO_RECEIVER_ERROR,
  type PlanRequest,
  type PortWire,
  type UserScriptsInvalidation,
  type WireAnswer,
  type WireExtensionPlan,
  type WireWorldPlan,
  type WorldDelivery,
  type WorldExecution,
  type WorldMessage,
  type WorldMessageResult
} from '../contracts/user-scripts.js'
import {
  WORLD_EVALUATOR,
  installUserScriptWorldApi,
  type PreloadToWorld,
  type WorldApiConfig,
  type WorldEvalResult,
  type WorldToPreload
} from './user-script-world.js'

/**
 * The page side of `chrome.userScripts`, run by the page preload in every frame of every tab.
 * At document start it asks the host (synchronously) what the extensions inject into this frame
 * and runs it at Chrome's times: `MAIN` scripts in the page's world, `USER_SCRIPT` ones in an
 * isolated world of their own per extension and `worldId`, each world given the extension's
 * origin and CSP (`webFrame.setIsolatedWorldInfo`) and the world API (`shared/userScriptWorld`)
 * before its first script. The worlds' messaging crosses to this world through `CustomEvent`s
 * on `document` under names picked here, and on to the host over IPC; `tabs.sendMessage`
 * deliveries and `userScripts.execute` come the other way and are answered under their token.
 *
 * Everything Electron-specific arrives through `UserScriptsBridge`, so the runner can be tested
 * against a fake.
 */
export interface UserScriptsBridge {
  /**
   * The frame's plan, asked once at document start – the `userScripts` field of the page's one
   * synchronous document-start ask (`shared/documentStart.ts`), which the page preload carries.
   */
  plan(request: PlanRequest): unknown
  /** `ipcRenderer.invoke`: a world's `runtime.sendMessage`. */
  message(message: WorldMessage): Promise<unknown>
  /** `ipcRenderer.send`: the world's side of a port. */
  port(wire: PortWire): void
  /** `ipcRenderer.send`: the answer to a delivery or an execution. */
  answer(answer: WireAnswer): void
  /** `ipcRenderer.on`, host → this frame. */
  onPort(listener: (wire: PortWire) => void): void
  onDeliver(listener: (delivery: WorldDelivery) => void): void
  onExecute(listener: (execution: WorldExecution) => void): void
  onInvalidate(listener: (invalidation: UserScriptsInvalidation) => void): void
  /**
   * `webFrame.executeJavaScript`: the page's own world. Both engines run a request synchronously
   * in the frame (the promise carries the result), so requests made in sequence run in sequence.
   */
  executeInMainWorld(code: string): Promise<unknown>
  /** `webFrame.executeJavaScriptInIsolatedWorld`. */
  executeInIsolatedWorld(worldId: number, code: string): Promise<unknown>
  /** `webFrame.setIsolatedWorldInfo`. */
  setIsolatedWorldInfo(
    worldId: number,
    info: { securityOrigin: string; csp?: string; name: string }
  ): void
}

/**
 * Isolated world ids start here: Electron's context-isolation world is 999 and Chromium gives
 * extensions' content scripts small ids; these stay clear of both.
 */
export const FIRST_USER_SCRIPT_WORLD_ID = 100_000

/** Chrome runs `document_idle` scripts this long after `DOMContentLoaded` at the latest. */
const IDLE_DELAY_MS = 200

const PHASES: readonly UserScriptRunAt[] = ['document_start', 'document_end', 'document_idle']

interface WorldRecord {
  key: string
  seq: number
  extensionId: string
  worldId: string | null
  isolatedWorldId: number
  messaging: boolean
  inbound: string
  outbound: string
  /** World port id → this document's port id. */
  ports: Map<string, string>
}

interface PendingDelivery {
  world: WorldRecord
  resolve(answer: { handled: boolean; responded: boolean; result?: unknown }): void
}

interface ScheduledInjection {
  extensionId: string
  run(): void
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return String(error)
}

function randomName(): string {
  return `setsuna-us-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

/** A bridge call as a promise even when it throws instead of rejecting. */
function attempt(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return fn()
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

export function installUserScripts(bridge: UserScriptsBridge): void {
  const worlds = new Map<string, WorldRecord>()
  /** This document's port id → the world holding it. */
  const portWorlds = new Map<string, WorldRecord>()
  const pendingDeliveries = new Map<number, PendingDelivery>()
  const generations = new Map<string, number>()
  let worldSeq = 0
  let deliveryTokens = 0

  // ---------------------------------------------------------------------------
  // Chrome's injection times
  // ---------------------------------------------------------------------------

  const queues: Record<UserScriptRunAt, ScheduledInjection[]> = {
    document_start: [],
    document_end: [],
    document_idle: []
  }
  const reached: Record<UserScriptRunAt, boolean> = {
    document_start: false,
    document_end: false,
    document_idle: false
  }

  function at(phase: UserScriptRunAt, extensionId: string, run: () => void): void {
    if (reached[phase]) run()
    else queues[phase].push({ extensionId, run })
  }

  function reach(phase: UserScriptRunAt): void {
    if (reached[phase]) return
    // The phases are ordered: an end reached before the document element was seen runs the
    // start scripts first.
    if (phase !== 'document_start') reach('document_start')
    if (phase === 'document_idle') reach('document_end')
    reached[phase] = true
    for (const task of queues[phase].splice(0)) {
      try {
        task.run()
      } catch (error) {
        console.error('[browser] user script injection failed', error)
      }
    }
  }

  function scheduleIdle(): void {
    if (document.readyState === 'complete') {
      reach('document_idle')
      return
    }
    window.addEventListener('load', () => reach('document_idle'), { once: true })
    setTimeout(() => reach('document_idle'), IDLE_DELAY_MS)
  }

  // `document_start` is Chrome's "the document element exists, nothing else does yet": the
  // preload runs before the `<html>` element is created, so the runner waits for it.
  if (document.documentElement) {
    reach('document_start')
  } else {
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return
      observer.disconnect()
      reach('document_start')
    })
    observer.observe(document, { childList: true })
  }
  if (document.readyState !== 'loading') {
    reach('document_end')
    scheduleIdle()
  } else {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        reach('document_end')
        scheduleIdle()
      },
      { once: true }
    )
  }

  // ---------------------------------------------------------------------------
  // Worlds
  // ---------------------------------------------------------------------------

  function worldKey(extensionId: string, worldId: string | null): string {
    return `${extensionId}^@${worldId ?? ''}`
  }

  function sendToWorld(world: WorldRecord, payload: PreloadToWorld): void {
    try {
      document.dispatchEvent(new CustomEvent(world.inbound, { detail: JSON.stringify(payload) }))
    } catch {
      /* the document is going away, or the payload cannot be serialised */
    }
  }

  /** The isolated world of one extension and `worldId` in this document, made on first use. */
  function ensureWorld(
    extensionId: string,
    worldId: string | null,
    config: { csp: string | null; messaging: boolean; incognito: boolean }
  ): WorldRecord {
    const key = worldKey(extensionId, worldId)
    const existing = worlds.get(key)
    if (existing) return existing
    worldSeq += 1
    const world: WorldRecord = {
      key,
      seq: worldSeq,
      extensionId,
      worldId,
      isolatedWorldId: FIRST_USER_SCRIPT_WORLD_ID + worldSeq - 1,
      messaging: config.messaging,
      inbound: randomName(),
      outbound: randomName(),
      ports: new Map()
    }
    worlds.set(key, world)
    document.addEventListener(world.outbound, (event) => {
      const detail: unknown = (event as CustomEvent).detail
      if (typeof detail !== 'string') return
      let payload: unknown
      try {
        payload = JSON.parse(detail)
      } catch {
        return
      }
      if (isRecord(payload) && typeof payload.kind === 'string') {
        fromWorld(world, payload as WorldToPreload)
      }
    })
    const info: { securityOrigin: string; csp?: string; name: string } = {
      securityOrigin: `chrome-extension://${extensionId}`,
      name: `Setsuna user scripts ${extensionId}${worldId ? ` (${worldId})` : ''}`
    }
    if (config.csp) info.csp = config.csp
    try {
      bridge.setIsolatedWorldInfo(world.isolatedWorldId, info)
    } catch (error) {
      console.error('[browser] user script world could not be configured', error)
    }
    const apiConfig: WorldApiConfig = {
      extensionId,
      incognito: config.incognito,
      messaging: config.messaging,
      inbound: world.inbound,
      outbound: world.outbound
    }
    // The world API goes in first; the engine runs it before anything asked of the world later.
    const code = `(${installUserScriptWorldApi.toString()})(${JSON.stringify(apiConfig)});`
    runInWorld(world, code).catch((error: unknown) => {
      console.error('[browser] user script world API failed to install', error)
    })
    return world
  }

  function runInWorld(world: WorldRecord, code: string): Promise<unknown> {
    return attempt(() => bridge.executeInIsolatedWorld(world.isolatedWorldId, code))
  }

  // ---------------------------------------------------------------------------
  // The plan: what runs in this frame
  // ---------------------------------------------------------------------------

  function runPlan(plans: WireExtensionPlan[]): void {
    for (const plan of plans) {
      for (const worldPlan of plan.worlds) runWorldPlan(plan, worldPlan)
    }
  }

  function runWorldPlan(plan: WireExtensionPlan, worldPlan: WireWorldPlan): void {
    const world =
      worldPlan.world === 'MAIN'
        ? null
        : ensureWorld(plan.extensionId, worldPlan.worldId, {
            csp: worldPlan.csp,
            messaging: worldPlan.messaging,
            incognito: plan.incognito
          })
    // Chrome's order: by phase, then registration order, each `js` source in turn. A phase's
    // scripts start on the turn the phase is reached, which is what `document_start` needs.
    for (const phase of PHASES) {
      const scripts = worldPlan.scripts.filter((script) => script.runAt === phase)
      if (scripts.length === 0) continue
      at(phase, plan.extensionId, () => {
        for (const script of scripts) {
          for (const code of script.code) {
            const run = world
              ? runInWorld(world, code)
              : attempt(() => bridge.executeInMainWorld(code))
            run.catch((error: unknown) => {
              console.error(
                `[browser] user script '${script.id}' of ${plan.extensionId} failed: ${errorMessage(error)}`
              )
            })
          }
        }
      })
    }
  }

  // ---------------------------------------------------------------------------
  // World → preload → host
  // ---------------------------------------------------------------------------

  function fromWorld(world: WorldRecord, payload: WorldToPreload): void {
    if (worlds.get(world.key) !== world) return
    switch (payload.kind) {
      case 'message': {
        if (!world.messaging) {
          sendToWorld(world, { kind: 'response', id: payload.id, error: NO_RECEIVER_ERROR })
          return
        }
        const message: WorldMessage = {
          extensionId: world.extensionId,
          worldId: world.worldId,
          message: payload.message
        }
        bridge.message(message).then(
          (raw: unknown) => {
            const result = isRecord(raw) ? (raw as WorldMessageResult) : {}
            const response: PreloadToWorld = { kind: 'response', id: payload.id }
            if (typeof result.error === 'string') response.error = result.error
            else if (result.result !== undefined) response.result = result.result
            sendToWorld(world, response)
          },
          (error: unknown) => {
            sendToWorld(world, { kind: 'response', id: payload.id, error: errorMessage(error) })
          }
        )
        return
      }
      case 'connect': {
        const portId = `${world.seq}:${payload.portId}`
        if (!world.messaging) {
          sendToWorld(world, {
            kind: 'port-disconnect',
            portId: payload.portId,
            error: NO_RECEIVER_ERROR
          })
          return
        }
        world.ports.set(payload.portId, portId)
        portWorlds.set(portId, world)
        bridge.port({
          kind: 'connect',
          portId,
          extensionId: world.extensionId,
          worldId: world.worldId,
          name: payload.name
        })
        return
      }
      case 'port-message': {
        const portId = world.ports.get(payload.portId)
        if (portId) bridge.port({ kind: 'message', portId, message: payload.message })
        return
      }
      case 'port-disconnect': {
        const portId = world.ports.get(payload.portId)
        if (!portId) return
        world.ports.delete(payload.portId)
        portWorlds.delete(portId)
        bridge.port({ kind: 'disconnect', portId })
        return
      }
      case 'response': {
        const pending = pendingDeliveries.get(payload.token)
        if (pending?.world !== world) return
        pendingDeliveries.delete(payload.token)
        pending.resolve({
          handled: payload.handled,
          responded: payload.responded,
          result: payload.result
        })
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Host → preload → world
  // ---------------------------------------------------------------------------

  bridge.onInvalidate((invalidation) => {
    if (!isRecord(invalidation) || typeof invalidation.extensionId !== 'string') return
    const id = invalidation.extensionId
    generations.set(id, (generations.get(id) ?? 0) + 1)
    for (const phase of PHASES) queues[phase] = queues[phase].filter((task) => task.extensionId !== id)
    for (const world of worlds.values()) {
      if (world.extensionId !== id) continue
      worlds.delete(world.key)
      for (const [ownId, portId] of world.ports) {
        portWorlds.delete(portId)
        sendToWorld(world, { kind: 'port-disconnect', portId: ownId, error: NO_RECEIVER_ERROR })
      }
      world.ports.clear()
    }
    for (const [token, pending] of pendingDeliveries) {
      if (pending.world.extensionId !== id) continue
      pendingDeliveries.delete(token)
      pending.resolve({ handled: false, responded: false })
    }
  })

  bridge.onPort((wire) => {
    if (!isRecord(wire) || typeof wire.portId !== 'string') return
    const world = portWorlds.get(wire.portId)
    if (!world) return
    let worldPortId: string | undefined
    for (const [own, mapped] of world.ports) {
      if (mapped === wire.portId) {
        worldPortId = own
        break
      }
    }
    if (worldPortId === undefined) return
    if (wire.kind === 'message') {
      sendToWorld(world, { kind: 'port-message', portId: worldPortId, message: wire.message })
    } else if (wire.kind === 'disconnect') {
      world.ports.delete(worldPortId)
      portWorlds.delete(wire.portId)
      const payload: PreloadToWorld = { kind: 'port-disconnect', portId: worldPortId }
      if (typeof wire.error === 'string') payload.error = wire.error
      sendToWorld(world, payload)
    }
  })

  /**
   * A `tabs.sendMessage` from the extension: its messaging-enabled user-script worlds in this frame
   * gets `runtime.onMessage`; the first response wins, as in Chrome.
   */
  bridge.onDeliver((delivery) => {
    if (!isRecord(delivery) || typeof delivery.token !== 'number') return
    const targets = [...worlds.values()].filter((w) => w.extensionId === delivery.extensionId && w.messaging)
    if (targets.length === 0) {
      bridge.answer({ token: delivery.token, handled: false, responded: false })
      return
    }
    let answered = false
    let handled = false
    let remaining = targets.length
    const finish = (answer: WireAnswer): void => {
      if (answered) return
      answered = true
      bridge.answer(answer)
    }
    for (const world of targets) {
      deliveryTokens += 1
      const token = deliveryTokens
      pendingDeliveries.set(token, {
        world,
        resolve: (result) => {
          if (result.handled) handled = true
          if (result.responded) {
            finish({ token: delivery.token, handled: true, responded: true, result: result.result })
          }
          remaining -= 1
          if (remaining === 0) finish({ token: delivery.token, handled, responded: false })
        }
      })
      sendToWorld(world, {
        kind: 'deliver',
        token,
        message: delivery.message,
        sender: delivery.sender
      })
    }
  })

  /** `userScripts.execute` in one world of this frame, answered with the last value or the error. */
  bridge.onExecute((execution) => {
    if (!isRecord(execution) || typeof execution.token !== 'number') return
    const generation = generations.get(execution.extensionId) ?? 0
    // A later, authorized execute may reuse the document. It must not revive work
    // submitted before revocation, including sources still waiting on an earlier await.
    const current = () => (generations.get(execution.extensionId) ?? 0) === generation
    const run = (): void => {
      void execute(execution, current).then(
        (result) => bridge.answer({ token: execution.token, result }),
        (error: unknown) => bridge.answer({ token: execution.token, error: errorMessage(error) })
      )
    }
    if (execution.injectImmediately) run()
    else at('document_idle', execution.extensionId, run)
  })

  async function execute(execution: WorldExecution, current: () => boolean): Promise<unknown> {
    const check = () => { if (!current()) throw new Error('User script execution cancelled.') }
    check()
    if (execution.world === 'MAIN') {
      let last: unknown
      for (const code of execution.code) {
        check()
        last = await attempt(() => bridge.executeInMainWorld(code))
      }
      return last
    }
    const world = ensureWorld(execution.extensionId, execution.worldId, {
      csp: execution.csp,
      messaging: execution.messaging,
      incognito: execution.incognito
    })
    let last: unknown
    for (const code of execution.code) {
      check()
      // Through the world's evaluator, so a thrown error comes back with its message; a world
      // whose CSP forbids eval runs the code plainly (a failure is then Electron's generic one).
      const evaluated: unknown = await runInWorld(
        world,
        `${WORLD_EVALUATOR}(${JSON.stringify(code)})`
      )
      const outcome = isRecord(evaluated) ? (evaluated as WorldEvalResult) : {}
      if (outcome.noEval) {
        check()
        last = await runInWorld(world, code)
        continue
      }
      if (typeof outcome.error === 'string') throw new Error(outcome.error)
      last = outcome.value
    }
    return last
  }

  // ---------------------------------------------------------------------------
  // Go
  // ---------------------------------------------------------------------------

  let plans: unknown
  try {
    plans = bridge.plan({ url: location.href })
  } catch {
    plans = undefined
  }
  if (Array.isArray(plans)) runPlan(plans.filter(isExtensionPlan))
}

function isExtensionPlan(value: unknown): value is WireExtensionPlan {
  return isRecord(value) && typeof value.extensionId === 'string' && Array.isArray(value.worlds)
}
