// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAccountStore } from "@/stores/account";
import { useSubaccountSelectionLock } from "./useSubaccountSelectionLock";

describe("useSubaccountSelectionLock", () => {
  beforeEach(() => useAccountStore.setState({ selectionLocked: false }));

  it("owns the global lock for the active trade lifecycle and releases it on cleanup", () => {
    const { rerender, unmount } = renderHook(
      ({ isLocked }) => useSubaccountSelectionLock(isLocked),
      { initialProps: { isLocked: false } },
    );
    expect(useAccountStore.getState().selectionLocked).toBe(false);

    rerender({ isLocked: true });
    expect(useAccountStore.getState().selectionLocked).toBe(true);

    rerender({ isLocked: false });
    expect(useAccountStore.getState().selectionLocked).toBe(false);

    rerender({ isLocked: true });
    unmount();
    expect(useAccountStore.getState().selectionLocked).toBe(false);
  });
});
