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
export function saga<This extends object, Args extends any[], Return>(
  target: undefined,
  context: ClassFieldDecoratorContext<This, (this: This, ...args: Args) => Return>,
): () => (this: This, ...args: Args) => Return;
export function saga<This extends object, Args extends any[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
): typeof target;
export function saga<This extends object, Args extends any[], Return>(
  target: ((this: This, ...args: Args) => Return) | undefined,
  context:
    | ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>
    | ClassFieldDecoratorContext<This, (this: This, ...args: Args) => Return>,
):
  | typeof target
  | ((this: This, initValue: (this: undefined, ...args: Args) => Return) => (this: This, ...args: Args) => Return)
  | undefined {
  if (!target)
    return function init(this: This, trueTarget: (this: void, ...args: Args) => Return) {
      return sagaImpl<This, Args, Return>(trueTarget, context, this);
    };
  return sagaImpl<This, Args, Return>(target, context);
}
let AsyncLocalStorageClass: typeof import("node:async_hooks").AsyncLocalStorage | undefined;
try {
  AsyncLocalStorageClass = await import("node:async_hooks").then(v => v.AsyncLocalStorage);
} catch {}
function sagaImpl<This extends object, Args extends any[], Return>(
  target: (this: This, ...args: Args) => Return,
  context:
    | ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>
    | ClassFieldDecoratorContext<This, (this: This, ...args: Args) => Return>,
  that?: This
): typeof target {
  const methodName = String(context.name);

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const actionFn =
    context.kind === "field"
      ? (action(undefined, context)(target) as typeof target)
      : (action(target, context) as typeof target);

  const id = Math.random().toString().slice(2).padEnd(20, "0");
  sagaData[id] = { actionName: methodName };

  const obj = {
    [id](this: This, ...args: Args): Return {
      const self = that ?? this;
      if (sagaData[id] && self)
        sagaData[id].object =
          "WeakRef" in globalThis ? new globalThis.WeakRef(self) : { deref: () => self };
      if (AsyncLocalStorageClass !== undefined)
        try {
          asyncLocalStorage = new AsyncLocalStorageClass();
          return asyncLocalStorage.run(sagaData[id]!, () => actionFn.call(self, ...args));
        } catch {}
      const result = actionFn.call(self, ...args);
      if (!("WeakRef" in globalThis) && result instanceof Promise)
        void result.finally(() => void setTimeout(() => delete sagaData[id]?.object, 30000));
      return result;
    },
  };
  origFunctions.set(obj[id]!, target);

  return obj[id] satisfies
    | undefined
    | ((this: This, ...args: Args) => Return | Promise<Return>) as NonNullable<typeof target>;
}
