import type { AsyncLocalStorage } from "node:async_hooks";

import { action } from "mobx";

import type { UnknownFunction } from "./function-reflection";

export interface SagaData {
  actionName: string;
  object?: {
    deref(): object | undefined;
  };
}
const sagaData: Record<string, SagaData> = {};
let asyncLocalStorage: AsyncLocalStorage<SagaData> | undefined;
declare global {
  interface Window {
    asyncStack?(): Promise<string | undefined>;
  }
}
export function getCurrentSagaData(): Promise<SagaData | undefined> | SagaData | undefined {
  if (asyncLocalStorage) return asyncLocalStorage?.getStore();
  let { stack } = new Error();
  const found = stack?.match(/(\d{20})/);
  if (!found) {
    if ("asyncStack" in globalThis && "asyncStack" in window) {
      return window.asyncStack().then((asyncStack) => {
        const newFound = asyncStack?.match(/(\d{20})/);
        if (!newFound) return undefined;
        const data = sagaData[newFound[1]!];
        if (!data) return undefined;
        return { ...data, stack: asyncStack };
      });
    }
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
  target: undefined,
  context: ClassFieldDecoratorContext<This, (this: This, ...args: Args) => Return>,
): () => (this: This, ...args: Args) => Return;
export function saga<This extends object, Args extends any[], Return extends Promise<unknown>>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
): typeof target;
export function saga<This extends object, Args extends any[], Return extends Promise<unknown>>(
  target: ((this: This, ...args: Args) => Return) | undefined,
  context:
    | ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>
    | ClassFieldDecoratorContext<This, (this: This, ...args: Args) => Return>,
):
  | typeof target
  | ((initValue: (this: This, ...args: Args) => Return) => (this: This, ...args: Args) => Return)
  | undefined {
  if (!target)
    return (target: (this: This, ...args: Args) => Return) => {
      return sagaImpl<This, Args, Return>(target, context);
    };
  return sagaImpl<This, Args, Return>(target, context);
}
function sagaImpl<This extends object, Args extends any[], Return extends Promise<unknown>>(
  target: (this: This, ...args: Args) => Return,
  context:
    | ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>
    | ClassFieldDecoratorContext<This, (this: This, ...args: Args) => Return>,
): typeof target {
  const methodName = String(context.name);

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const actionFn =
    context.kind === "field"
      ? (action(undefined, context)(target) as typeof target)
      : (action(target, context) as typeof target);

  const id = Math.random().toString().slice(2).padEnd(20, "0");
  sagaData[id] = { actionName: methodName };
  let AsyncLocalStorage: Storage | undefined | "browser";
  void import("node:async_hooks")
    .then((pkg) => (AsyncLocalStorage = pkg.AsyncLocalStorage))
    .catch(() => (AsyncLocalStorage = "browser"));

  const obj = {
    async [id](this: This, ...args: Args): Promise<Return> {
      if (sagaData[id])
        sagaData[id].object =
          "WeakRef" in globalThis ? new globalThis.WeakRef(this) : { deref: () => this };
      if (AsyncLocalStorage !== "browser")
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
      if (!("WeakRef" in globalThis))
        void result.finally(() => void setTimeout(() => delete sagaData[id]?.object, 30000));
      return result;
    },
  };
  origFunctions.set(obj[id]!, target);

  return obj[id] satisfies
    | undefined
    | ((this: This, ...args: Args) => Promise<Return>) as NonNullable<typeof target>;
}
