// oxlint-disable max-lines-per-function
// oxlint-disable typescript/no-unsafe-type-assertion
import * as mobx from "mobx";
import { autorun, observable } from "mobx";

import { getConstructor } from "./function-reflection";

export async function fromObservable<T>(v: () => T): Promise<Exclude<T, Error | undefined>> {
  await Promise.resolve();
  return new Promise((res, rej) => {
    const dispose = autorun(() => {
      const val = v();
      if (val) {
        if (val instanceof Error) {
          rej(val);
        } else {
          if (
            (Array.isArray(val) || val instanceof Map || val instanceof Set) &&
            "loading" in val &&
            val.loading
          )
            return;
          res(val as Exclude<T, Error | undefined>);
        }
        queueMicrotask(() => {
          dispose();
        });
      }
    });
  });
}
export function coherentValue<T extends { loading?: boolean } | undefined | Error>(
  v: () => T,
): Promise<Exclude<T, Error>> {
  const val = v();
  if (val === undefined || val instanceof Error || !val.loading) {
    return Promise.resolve(val) as Promise<Exclude<T, Error>>;
  }
  return fromObservable(v) as Promise<Exclude<T, Error>>;
}
export function promise<
  T,
  This extends Record<`get${Capitalize<Prop & string>}`, () => Promise<T>> &
    Record<`watch${Capitalize<Prop & string>}`, (cb: (val: T) => void) => void>,
  Prop extends keyof This,
>(prop: Prop) {
  return function decorator(
    target: ClassAccessorDecoratorTarget<This, ObservableAsyncValue<T>>,
    context: ClassAccessorDecoratorContext<This, ObservableAsyncValue<T>>,
  ): ClassAccessorDecoratorResult<This, ObservableAsyncValue<T>> | void {
    let hasInitialized = false;
    const observer: ClassAccessorDecoratorResult<This, ObservableAsyncValue<T>> | void = observable(
      target,
      context,
    );
    let wasWatched = false;
    const atom = mobx.createAtom(Math.random().toString(), () => {
      wasWatched = true;
    });

    return {
      get() {
        // oxlint-disable-next-line typescript/no-this-alias

        observer?.init?.apply(this, [undefined]);

        atom.reportObserved();

        const loader = this[`get${capitalize(prop)}`] as () => Promise<T>;
        const watcher = this[`watch${capitalize(prop)}`] as (cb: (val: T) => void) => void;
        if (hasInitialized) return observer?.get?.apply(this, []);
        if (!wasWatched) return undefined;
        hasInitialized = true;
        watcher((val) => {
          mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.push`, () =>
            observer?.set?.apply(this, [val]),
          )();
        });
        loader
          .apply(this, [])
          .then((v) => {
            mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.resolved`, () => {
              observer?.set?.apply(this, [v]);
            })();
          })
          .catch((e) => {
            mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.rejected`, () => {
              observer?.set?.apply(this, [e]);
            })();
          });

        return observer?.get?.apply(this, []);
      },
      init(value) {
        return observer?.init?.apply(this, [value]);
      },
      set(value) {
        observer?.init?.apply(this, [value]);
        observer?.set?.apply(this, [value]);
      },
    };
  };
}

export function map<
  T,
  This extends Record<
    `get${Capitalize<Prop & string>}`,
    () => AsyncGenerator<[key: string, val: T], void, void>
  > &
    Record<`watch${Capitalize<Prop & string>}`, (cb: (val: Map<string, T>) => void) => void>,
  Prop extends keyof This,
>(prop: Prop) {
  return function decorator(
    target: ClassAccessorDecoratorTarget<This, ObservableAsyncMapGenerator<T>>,
    context: ClassAccessorDecoratorContext<This, ObservableAsyncMapGenerator<T>>,
  ): ClassAccessorDecoratorResult<This, ObservableAsyncMapGenerator<T>> {
    let hasObserved = false;
    const observer: ClassAccessorDecoratorResult<
      This,
      { value: ObservableAsyncMapGenerator<T>; loading: boolean }
    > | void = observable(target, context);
    let wasWatched = false;
    const atom = mobx.createAtom(Math.random().toString(), () => {
      wasWatched = true;
    });

    return {
      get() {
        observer?.init?.apply(this, [{ value: undefined, loading: false }]);

        const loader = this[`get${capitalize(prop)}`] as () => AsyncGenerator<
          [key: string, val: T],
          void,
          void
        >;
        const watcher = this[`watch${capitalize(prop)}`] as (
          cb: (val: Map<string, T>) => void,
        ) => void;
        atom.reportObserved();
        if (!hasObserved) {
          if (!wasWatched) return undefined;
          hasObserved = true;
          watcher((val) => {
            mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.push`, () =>
              observer?.set?.apply(this, [{ value: val, loading: false }]),
            )();
          });
          const loadStream = async () => {
            await new Promise((r) => void setTimeout(r));
            try {
              const vals = new Map() as unknown as Exclude<
                ObservableAsyncMapGenerator<T>,
                Error | undefined
              >;
              vals.loading = true;
              mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.started`, () => {
                observer?.set?.apply(this, [{ value: vals, loading: true }]);
              })();
              for await (const [key, element] of loader.apply(this, [])) {
                vals.set(key, element);
                mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.yielded`, () => {
                  observer?.set?.apply(this, [{ value: vals, loading: true }]);
                })();
              }
              await new Promise((r) => void setTimeout(r));
              mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.finished`, () => {
                observer?.set?.apply(this, [{ value: vals, loading: false }]);
              })();
            } catch (error) {
              mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.error`, () => {
                observer?.set?.apply(this, [{ value: error as Error, loading: false }]);
              })();
            }
          };
          void loadStream();
        }

        const val = observer?.get?.apply(this, []);
        if (val?.value && !(val.value instanceof Error)) val.value.loading = val.loading;
        return val?.value;
      },
      init(value) {
        const res = observer?.init?.apply(this, [
          { value, loading: value instanceof Error ? false : !!value?.loading },
        ]);

        if (res?.value && !(res.value instanceof Error)) res.value.loading = res.loading;
        return res?.value;
      },
      set(vals) {
        observer?.init?.apply(this, [
          { value: vals, loading: vals instanceof Error ? false : !!vals?.loading },
        ]);
        observer?.set?.apply(this, [
          { value: vals, loading: vals instanceof Error ? false : !!vals?.loading },
        ]);
      },
    };
  };
}

export function set<
  T,
  This extends Record<`get${Capitalize<Prop & string>}`, () => AsyncGenerator<T, void, void>> &
    Record<`watch${Capitalize<Prop & string>}`, (cb: (val: Set<T>) => void) => void>,
  Prop extends keyof This,
>(prop: Prop) {
  return function decorator(
    target: ClassAccessorDecoratorTarget<This, ObservableAsyncSetGenerator<T>>,
    context: ClassAccessorDecoratorContext<This, ObservableAsyncSetGenerator<T>>,
  ): ClassAccessorDecoratorResult<This, ObservableAsyncSetGenerator<T>> {
    let hasObserved = false;
    const observer: ClassAccessorDecoratorResult<
      This,
      { value: ObservableAsyncSetGenerator<T>; loading: boolean }
    > | void = observable(target, context);
    let wasWatched = false;
    const atom = mobx.createAtom(Math.random().toString(), () => {
      wasWatched = true;
    });

    return {
      get() {
        observer?.init?.apply(this, [{ value: undefined, loading: false }]);

        const loader = this[`get${capitalize(prop)}`] as () => AsyncGenerator<T, void, void>;
        const watcher = this[`watch${capitalize(prop)}`] as (cb: (val: Set<T>) => void) => void;
        atom.reportObserved();
        if (!hasObserved) {
          if (!wasWatched) return undefined;
          hasObserved = true;
          watcher((val) => {
            mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.push`, () =>
              observer?.set?.apply(this, [{ value: val, loading: false }]),
            )();
          });
          const loadStream = async () => {
            await new Promise((r) => void setTimeout(r));
            try {
              const vals = new Set() as unknown as Exclude<
                ObservableAsyncSetGenerator<T>,
                Error | undefined
              >;
              vals.loading = true;
              mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.started`, () => {
                observer?.set?.apply(this, [{ value: vals, loading: true }]);
              })();
              for await (const element of loader.apply(this, [])) {
                vals.add(element);
                mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.yielded`, () => {
                  observer?.set?.apply(this, [{ value: vals, loading: true }]);
                })();
              }
              await new Promise((r) => void setTimeout(r));
              mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.finished`, () => {
                observer?.set?.apply(this, [{ value: vals, loading: false }]);
              })();
            } catch (error) {
              mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.error`, () => {
                observer?.set?.apply(this, [{ value: error as Error, loading: false }]);
              })();
            }
          };
          void loadStream();
        }

        const val = observer?.get?.apply(this, []);
        if (val?.value && !(val.value instanceof Error)) val.value.loading = val.loading;
        return val?.value;
      },
      init(value) {
        const res = observer?.init?.apply(this, [
          { value, loading: value instanceof Error ? false : !!value?.loading },
        ]);

        if (res?.value && !(res.value instanceof Error)) res.value.loading = res.loading;
        return res?.value;
      },
      set(vals) {
        observer?.init?.apply(this, [
          { value: vals, loading: vals instanceof Error ? false : !!vals?.loading },
        ]);
        observer?.set?.apply(this, [
          { value: vals, loading: vals instanceof Error ? false : !!vals?.loading },
        ]);
      },
    };
  };
}

export function array<
  T,
  This extends Record<`get${Capitalize<Prop & string>}`, () => AsyncGenerator<T, void, void>> &
    Record<`watch${Capitalize<Prop & string>}`, (cb: (val: T[]) => void) => void>,
  Prop extends keyof This,
>(prop: Prop) {
  return function decorator(
    target: ClassAccessorDecoratorTarget<This, ObservableAsyncGenerator<T>>,
    context: ClassAccessorDecoratorContext<This, ObservableAsyncGenerator<T>>,
  ): ClassAccessorDecoratorResult<This, ObservableAsyncGenerator<T>> {
    let hasObserved = false;
    const observer: ClassAccessorDecoratorResult<
      This,
      { value: ObservableAsyncGenerator<T>; loading: boolean }
    > | void = observable(target, context);
    let wasWatched = false;
    const atom = mobx.createAtom(Math.random().toString(), () => {
      wasWatched = true;
    });

    return {
      get() {
        observer?.init?.apply(this, [{ value: undefined, loading: false }]);

        const loader = this[`get${capitalize(prop)}`] as () => AsyncGenerator<T, void, void>;
        const watcher = this[`watch${capitalize(prop)}`] as (cb: (val: T[]) => void) => void;
        atom.reportObserved();
        if (!hasObserved) {
          if (!wasWatched) return undefined;
          hasObserved = true;
          watcher((val) => {
            mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.push`, () =>
              observer?.set?.apply(this, [{ value: val, loading: false }]),
            )();
          });
          const loadStream = async () => {
            await new Promise((r) => void setTimeout(r));
            try {
              const vals = [] as unknown as Exclude<ObservableAsyncGenerator<T>, Error | undefined>;
              vals.loading = true;
              mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.started`, () => {
                observer?.set?.apply(this, [{ value: vals, loading: true }]);
              })();
              for await (const element of loader.apply(this, [])) {
                vals.push(element);
                mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.yielded`, () => {
                  observer?.set?.apply(this, [{ value: vals, loading: true }]);
                })();
              }
              await new Promise((r) => void setTimeout(r));
              mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.finished`, () => {
                observer?.set?.apply(this, [{ value: vals, loading: false }]);
              })();
            } catch (error) {
              mobx.action(`${getConstructor(this)?.name}.${String(context.name)}.error`, () => {
                observer?.set?.apply(this, [{ value: error as Error, loading: false }]);
              })();
            }
          };
          void loadStream();
        }

        const val = observer?.get?.apply(this, []);
        if (val?.value && !(val.value instanceof Error)) val.value.loading = val.loading;
        return val?.value;
      },
      init(value) {
        const res = observer?.init?.apply(this, [
          { value, loading: value instanceof Error ? false : !!value?.loading },
        ]);

        if (res?.value && !(res.value instanceof Error)) res.value.loading = res.loading;
        return res?.value;
      },
      set(vals) {
        observer?.init?.apply(this, [
          { value: vals, loading: vals instanceof Error ? false : !!vals?.loading },
        ]);
        observer?.set?.apply(this, [
          { value: vals, loading: vals instanceof Error ? false : !!vals?.loading },
        ]);
      },
    };
  };
}
export type ObservableAsyncValue<T> = T | Error | undefined;
export type ObservableAsyncGenerator<T> =
  | (T[] & {
      /** Flag that tracks if the generator is still producing values */
      loading?: boolean;
    })
  | Error
  | undefined;
export type ObservableAsyncMapGenerator<T> =
  | (Map<string, T> & {
      /** Flag that tracks if the generator is still producing values */
      loading?: boolean;
    })
  | Error
  | undefined;
export type ObservableAsyncSetGenerator<T> =
  | (Set<T> & {
      /** Flag that tracks if the generator is still producing values */
      loading?: boolean;
    })
  | Error
  | undefined;
export type AsyncObservableGenerator<
  Name extends string,
  Value,
  Params extends unknown[] = [],
> = Record<Name, ObservableAsyncGenerator<Value>> &
  Record<`get${Capitalize<Name>}`, (...args: Params) => AsyncGenerator<Value, void, void>> & {
    [P in Name as `watch${Capitalize<Name>}`]: (
      cb: (val: Value[]) => void,
      ...args: Params
    ) => Promise<void> | void;
  };
export type AsyncObservableMapGenerator<
  Name extends string,
  Value,
  Params extends unknown[] = [],
> = Record<Name, ObservableAsyncMapGenerator<Value>> &
  Record<
    `get${Capitalize<Name>}`,
    (...args: Params) => AsyncGenerator<[key: string, val: Value], void, void>
  > & {
    [P in Name as `watch${Capitalize<Name>}`]: (
      cb: (val: Map<string, Value>) => void,
      ...args: Params
    ) => Promise<void> | void;
  };
export type AsyncObservableSetGenerator<
  Name extends string,
  Value,
  Params extends unknown[] = [],
> = Record<Name, ObservableAsyncSetGenerator<Value>> &
  Record<`get${Capitalize<Name>}`, (...args: Params) => AsyncGenerator<Value, void, void>> & {
    [P in Name as `watch${Capitalize<Name>}`]: (
      cb: (val: Set<Value>) => void,
      ...args: Params
    ) => Promise<void> | void;
  };
export function capitalize<T extends string | symbol | number>(prop: T): Capitalize<T & string> {
  if (prop.toString().length === 0) {
    return "" as Capitalize<T & string>;
  }
  const capitalized = prop.toString()[0]!.toUpperCase() + prop.toString().slice(1);
  return capitalized as Capitalize<T & string>;
}
