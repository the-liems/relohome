import { AsyncLocalStorage } from 'node:async_hooks'
import { OperationError } from './errors.js'

const operations = new AsyncLocalStorage<{ signal: AbortSignal; deadline: number }>()
export function operationContext() { return operations.getStore() }
export function checkOperation() {
  const context = operationContext()
  if (context?.signal.aborted) throw abortError(context.signal)
}
export function abortError(signal: AbortSignal) {
  return new OperationError(signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED',
    signal.reason?.name === 'TimeoutError' ? 'Operation deadline exceeded.' : 'Operation cancelled.')
}

/** A nested service shares the caller's budget; it cannot reset the deadline. */
export async function withinOperation<T>(task: () => Promise<T>, callerSignal?: AbortSignal, timeoutMs = 15_000): Promise<T> {
  if (operationContext()) { checkOperation(); return task() }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('Deadline exceeded', 'TimeoutError')), timeoutMs)
  const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal
  let onAbort: () => void = () => {}
  try {
    return await operations.run({ signal, deadline: Date.now() + timeoutMs }, async () => {
      checkOperation()
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(abortError(signal))
        signal.addEventListener('abort', onAbort, { once: true })
      })
      return Promise.race([Promise.resolve().then(task), cancelled])
    })
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    controller.abort()
  }
}
