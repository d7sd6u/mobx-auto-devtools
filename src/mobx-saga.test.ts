// oxlint-disable typescript/no-unsafe-assignment
// oxlint-disable max-classes-per-file
import { test, describe, vi, expect } from "vitest";

import { getConstructor } from "./function-reflection";
import { getCurrentSagaData, saga, type SagaData } from "./mobx-saga";

describe("@saga", () => {
  test("it works", async () => {
    const spy = vi.fn<(data: SagaData | undefined) => void>();
    class TestClass {
      @saga async nonSyncMethod() {
        const data = await getCurrentSagaData();
        spy(data);
      }
    }
    const instance = new TestClass();
    await instance.nonSyncMethod();
    expect(spy).toHaveBeenCalledExactlyOnceWith({
      actionName: "nonSyncMethod",
      object: expect.any(WeakRef),
    } satisfies SagaData);
    expect(spy.mock.lastCall?.[0]?.object?.deref()).toBe(instance);
  });
  test("it works with arrow functions", async () => {
    const spy = vi.fn<(data: SagaData | undefined) => void>();
    class TestClass {
      @saga nonSyncMethod = async () => {
        const data = await getCurrentSagaData();
        spy(data);
      };
    }
    const instance = new TestClass();
    await instance.nonSyncMethod();
    expect(spy).toHaveBeenCalledExactlyOnceWith({
      actionName: "nonSyncMethod",
      object: expect.any(WeakRef),
    } satisfies SagaData);
    expect(spy.mock.lastCall?.[0]?.object?.deref()).toBe(instance);
    expect(getConstructor(spy.mock.lastCall?.[0]?.object?.deref())?.name).toBe("TestClass");
  });
});
