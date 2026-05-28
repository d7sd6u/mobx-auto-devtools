import type { AsyncLocalStorage } from "node:async_hooks";

import { action } from "mobx";

import type { UnknownFunction } from "./function-reflection";

export interface SagaData {
  actionName: string;
  object?: object;
}
const sagaData: Record<string, SagaData> = {};
let asyncLocalStorage: AsyncLocalStorage<SagaData> | undefined;
export function getCurrentSagaData(): SagaData | undefined {
  if (asyncLocalStorage) return asyncLocalStorage?.getStore();
  const { stack } = new Error();
  const found = stack?.match(/(\d{20})/);
  if (!found) {
    return undefined;
  }

  return sagaData[found[1]!];
}
const origFunctions = new WeakMap<UnknownFunction, UnknownFunction>();
export function getOrigFunction(fn: UnknownFunction): Function | undefined {
  return origFunctions.get(fn);
}
type Storage = typeof AsyncLocalStorage;
export function saga<This extends object, Args extends any[], Return extends Promise<unknown>>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
): typeof target | undefined {
  const methodName = String(context.name);

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const actionFn = action(target, context) as typeof target;

  const id = Math.random().toString().slice(2).padEnd(20, "0");
  sagaData[id] = { actionName: methodName };
  let AsyncLocalStorage: Storage | undefined | "browser";
  void import("node:async_hooks")
    .then((pkg) => (AsyncLocalStorage = pkg.AsyncLocalStorage))
    .catch(() => (AsyncLocalStorage = "browser"));

  const obj = {
    async [id](this: This, ...args: Args): Promise<Return> {
      if (sagaData[id]) sagaData[id].object = this;
      if (AsyncLocalStorage && AsyncLocalStorage !== "browser")
        try {
          if (!AsyncLocalStorage) {
            AsyncLocalStorage = (await import("node:async_hooks")).AsyncLocalStorage;
          }
          asyncLocalStorage = new AsyncLocalStorage();
          return asyncLocalStorage.run(sagaData[id]!, () => actionFn.call(this, ...args));
        } catch {
          AsyncLocalStorage = "browser";
        }
      const result = actionFn.call(this, ...args);
      void result.finally(() => void setTimeout(() => delete sagaData[id], 30000));
      return result;
    },
  };
  origFunctions.set(obj[id]!, target);

  return obj[id] satisfies
    | undefined
    | ((this: This, ...args: Args) => Promise<Return>) as typeof target;
}
