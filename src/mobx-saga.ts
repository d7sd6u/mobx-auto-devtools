import { action } from "mobx";

import type { UnknownFunction } from "./function-reflection";

export interface SagaData {
  actionName: string;
  object?: object;
}
const sagaData: Record<string, SagaData> = {};
export function getCurrentSagaData() {
  const { stack } = new Error();
  const found = stack?.match(/(?:^|\n)(\d{20})@/);
  if (!found) {
    return undefined;
  }

  return sagaData[found[1]!];
}
const origFunctions = new WeakMap<UnknownFunction, UnknownFunction>();
export function getOrigFunction(fn: UnknownFunction) {
  return origFunctions.get(fn);
}
export function saga<This extends object, Args extends any[], Return extends Promise<unknown>>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) {
  const methodName = String(context.name);

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const actionFn = action(target, context) as typeof target;

  const id = Math.random().toString().slice(2).padEnd(20, "0");
  sagaData[id] = { actionName: methodName };
  const obj = {
    [id](this: This, ...args: Args): Return {
      if (sagaData[id]) sagaData[id].object = this;
      const result = actionFn.call(this, ...args);
      void result.finally(() => void setTimeout(() => delete sagaData[id], 30000));
      return result;
    },
  };
  origFunctions.set(obj[id]!, target);

  return obj[id];
}
