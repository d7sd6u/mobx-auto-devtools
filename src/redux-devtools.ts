// oxlint-disable max-lines-per-function
// oxlint-disable-next-line unicorn/require-module-specifiers
import type {} from "@redux-devtools/extension";
// oxlint-disable typescript/no-unsafe-type-assertion
import { register } from "friendly-mobx-console-formatter";
import JSAN from "jsan";
import { runInAction, spy } from "mobx";
import * as mobx from "mobx";
import type { PureSpyEvent } from "mobx/dist/internal";

import { getConstructor, reflectFunctionParams } from "./function-reflection";
import { getObservableMap, Serializable, serializedRoot } from "./mobx";
import { getCurrentSagaData, type SagaData, getOrigFunction } from "./mobx-saga";

// oxlint-disable-next-line max-lines-per-function
function createDevtoolsConnection(name: string) {
  if (!window.__REDUX_DEVTOOLS_EXTENSION__) throw new Error("");
  const devTools = window.__REDUX_DEVTOOLS_EXTENSION__.connect({
    name,
    trace: (action: object | undefined) => {
      if (action !== undefined && "stack" in action && typeof action.stack === "string") {
        const stack = action.stack;
        delete action.stack;
        return (
          "Error:\n" +
          stack
            .split("\n")
            .filter(
              (l) =>
                !l.includes("Error:") &&
                !(l.includes("node:internal") && l.includes("async_hooks")),
            )
            .join("\n")
        );
      }
      return new Error().stack ?? "";
    },
    serialize: true,
  });
  const dev = devTools as typeof devTools & {
    subscribe: (
      fn: (
        event:
          | {
              type: "DISPATCH";
              source: string;
              payload: object;
              state: string;
            }
          | {
              type: "ACTION";
              source: string;
              payload: string;
              state: string;
            }
          | { type: "START" | "STOP" },
      ) => void,
    ) => void;
  };
  return dev;
}
// oxlint-disable-next-line max-lines-per-function
export function setupDevtools(name: string, root: WeakRef<Serializable>): () => void {
  try {
    register(mobx);

    const dev = createDevtoolsConnection(name);

    dev.subscribe((event) => {
      if (event.type === "START") {
        const derefed = root.deref();
        if (derefed) dev.send({ type: "@@INIT" }, serializedRoot(derefed));
        return;
      }
      if (event.type === "ACTION") {
        // oxlint-disable-next-line typescript/no-implied-eval
        const fn = new Function(event.payload);
        fn.apply(root.deref());
      }
      if (event.type !== "DISPATCH") return;

      const state = parseStateFromEvent(event) as typeof root;

      runInAction(function devtoolsDispatch() {
        const derefed = root.deref();
        if (derefed)
          for (const key of getObservableMap(state).keys()) {
            (derefed as Serializable & Record<string, unknown>)[key] =
              state[key as keyof typeof state];
          }
      });
    });
    let batch: EnrichedSpyEvent[] = [];

    spy((event: PureSpyEvent & { stack?: string | undefined }) => {
      if ("observableKind" in event && event.observableKind === "computed") return;
      if (
        event.type !== "report-end" &&
        event.type !== "scheduled-reaction" &&
        event.type !== "reaction"
      ) {
        event.stack = new Error().stack;
      }
      if (event.type === "action") {
        const fnSource = getFn(event)?.toString();
        if (fnSource?.startsWith("async ")) {
          const action: { type: string; stack?: string } = {
            type: actionName(event) + ".start",
            ...getArgs(event),
          };
          if (event.stack) action.stack = event.stack;
          const derefed = root.deref();
          if (derefed) dev.send(action, serializedRoot(derefed));
          return;
        }
      }
      if (event.type === "scheduled-reaction" || event.type === "reaction") {
        batch.push(event);
        batchedSpy(
          batch,
          () => {
            const derefed = root.deref();
            if (derefed) return serializedRoot(derefed);
            return "<garbage-collected>";
          },
          (...args) => {
            dev.send(...args);
          },
        );
        batch = [];
      } else {
        const data =
          event.type === "action" || event.type === "update" ? getCurrentSagaData() : undefined;
        const enrichedEvent: EnrichedSpyEvent =
          (event.type === "action" || event.type === "update") && data ? { ...event, data } : event;
        batch.push(enrichedEvent);
      }
    });

    const registry = new FinalizationRegistry(() => {
      if ("disconnect" in dev && typeof dev.disconnect === "function") dev.disconnect();
    });
    registry.register(root.deref() ?? {}, undefined);
    const derefed = root.deref();
    if (derefed) dev.init(serializedRoot(derefed));
    return () => {
      if ("disconnect" in dev && typeof dev.disconnect === "function") dev.disconnect();
    };
  } catch (error) {
    console.error(error);
  } finally {
    (window as typeof window & Record<`mobx_${string}_root`, unknown>)[`mobx_${name}_root`] =
      root.deref.bind(root);
  }
  return () => {};
}
function parseStateFromEvent(event: {
  type: "DISPATCH";
  source: string;
  payload: object;
  state: string;
}) {
  const rawState = JSAN.parse(
    JSON.stringify(
      JSON.parse(event.state, (_, val: unknown) => {
        if (!!val && typeof val === "object" && "$ref" in val) {
          return { $jsan: val.$ref };
        }
        return val;
      }),
    ),
  );

  const state = Serializable.fromObj(rawState);
  return state;
}

function batchedSpy(
  events: (PureSpyEvent & { stack?: string; data?: SagaData })[],
  sentVal: () => unknown,
  send: (action: { type: string }, payload: unknown) => void,
) {
  if (events.some((v) => v.type === "action" && v.name === "devtoolsDispatch")) return;
  const actions = events.filter((v) => v.type === "action");
  if (actions.length > 0) {
    const actionNames = actions.map((act) => actionName(act));
    const action: { type: string; stack?: string | undefined; args?: Record<string, unknown>[] } = {
      type: [...new Set(actionNames)].join(","),
    };
    if (actions.length === 1) {
      Object.assign(action, getArgs(actions[0]!));
    } else {
      action.args = actions.map((act) => getArgs(act));
    }
    if (events.some((e) => e.stack))
      action.stack = events
        .filter((v) => v.type !== "action" && v.stack)
        .map((e) => e.stack)
        .join("\n");
    send(action, sentVal());
  } else if (
    events.some(
      (event) =>
        event.type !== "error" &&
        event.type !== "reaction" &&
        event.type !== "report-end" &&
        event.type !== "scheduled-reaction",
    )
  ) {
    const datas = [getCurrentSagaData(), ...events.map((e) => e.data)];
    const process = (data: SagaData | undefined) => {
      const action: { type: string; stack?: string | undefined } = {
        type: data
          ? `${getConstructor(data.object?.deref())?.name}.${data.actionName}`
          : "<anonymous>",
      };
      if (events.some((e) => e.stack))
        action.stack = events
          .filter((v) => v.type !== "action" && v.stack)
          .map((e) => e.stack)
          .join("\n");
      if (data && "stack" in data && typeof data.stack === "string") action.stack = data.stack;
      send(action, sentVal());
    };
    const syncData = datas.find((v) => !!v && "actionName" in v);
    if (syncData) process(syncData);
    else {
      void Promise.all(datas.map((v) => Promise.resolve(v))).then((resolvedDatas) =>
        process(resolvedDatas.find((v) => !!v && "actionName" in v)),
      );
    }
  }
}
type Action = PureSpyEvent & { type: "action" } & { data?: SagaData };
type EnrichedSpyEvent = PureSpyEvent & { data?: SagaData };
function getFn(action: Action) {
  if (typeof action.object !== "object" || !action.object) return undefined;
  const obj: Partial<Record<string | number | symbol, unknown>> = action.object;
  const fn = obj[action.name];
  if (typeof fn !== "function") return undefined;
  return getOrigFunction(fn) ?? fn;
}
function getArgs(action: Action) {
  const fn = getFn(action);
  if (!fn) return {};
  return Object.fromEntries(reflectFunctionParams(fn).map((arg, i) => [arg, action.arguments[i]]));
}
const actionName = (v: Action) => {
  if (v.name.includes(".")) return v.name;
  try {
    const Class = getConstructor(v.object);
    return `${Class?.name}.${v.name}`;
  } catch {
    const data = v.data;
    return data?.object
      ? `${getConstructor(data.object.deref())?.name}.${data.actionName}`
      : `<anonymous>.${v.name}`;
  }
};
