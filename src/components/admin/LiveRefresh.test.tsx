// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), router: { refresh: vi.fn() } }));
mocks.router.refresh = mocks.refresh;
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
import { ADMIN_REFRESH_INTERVAL_MS, LiveRefresh } from "./LiveRefresh";

describe("Mission Control live refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    history.replaceState({}, "", "/admin?range=30d");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("refreshes the current server-rendered route every five seconds without changing its range", () => {
    render(<LiveRefresh/>);
    expect(mocks.refresh).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(ADMIN_REFRESH_INTERVAL_MS));

    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/admin");
    expect(window.location.search).toBe("?range=30d");
  });

  it("cleans up polling on unmount", () => {
    const view = render(<LiveRefresh/>);
    view.unmount();

    act(() => vi.advanceTimersByTime(ADMIN_REFRESH_INTERVAL_MS * 2));

    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not leave multiple refresh loops after a remount", () => {
    const first = render(<LiveRefresh/>);
    first.unmount();
    render(<LiveRefresh/>);

    act(() => vi.advanceTimersByTime(ADMIN_REFRESH_INTERVAL_MS));

    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});