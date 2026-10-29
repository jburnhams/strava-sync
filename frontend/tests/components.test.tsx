import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import Dashboard from "../src/Dashboard";
import UserDetail from "../src/UserDetail";

// Mock Recharts globally for these component tests to avoid ResizeObserver errors
vi.mock('recharts', async (importOriginal) => {
  const original = await importOriginal<typeof import('recharts')>();
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => (
      <div className="recharts-responsive-container">
        {React.cloneElement(children, { width: 500, height: 300 })}
      </div>
    ),
  };
});

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

// Mock navigation
const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ id: "123" }),
  };
});

describe("Frontend Components", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    navigateMock.mockReset();
    vi.clearAllMocks();
  });

  describe("Dashboard", () => {
    it("loads users and displays them", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ strava_id: 1, firstname: "Test", lastname: "User", profile_pic: "", last_synced_at: null }],
      });

      render(
        <BrowserRouter>
          <Dashboard />
        </BrowserRouter>
      );

      expect(screen.getByText("Loading...")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText("Test User")).toBeInTheDocument());
      expect(screen.getByText(/Never/)).toBeInTheDocument();
    });

    it("displays 'No users connected yet' when list is empty", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      render(
        <BrowserRouter>
          <Dashboard />
        </BrowserRouter>
      );

      await waitFor(() => expect(screen.getByText("No athletes synced yet.")).toBeInTheDocument());
    });

    it("handles fetch error gracefully", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network Error"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(
        <BrowserRouter>
          <Dashboard />
        </BrowserRouter>
      );

      await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
      // Ideally should show error message, but current implementation just stops loading and shows empty list (effectively)
      // or whatever state it was. Since empty list is default, let's check for empty state or if it crashes.
      // The current code catches error and sets loading=false. So users=[] (default).
      expect(screen.getByText("No athletes synced yet.")).toBeInTheDocument();

      consoleSpy.mockRestore();
    });
  });

  describe("UserDetail", () => {
    it("shows the athlete, last sync time and activities, with no sync button", async () => {
        fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ strava_id: 123, firstname: "Test", lastname: "User", profile_pic: "", last_synced_at: 100 }),
        });
        fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 1, name: "New Run", type: "Run", distance: 1000, start_date: "2023-01-01" }],
        });

        render(
        <BrowserRouter>
            <UserDetail />
        </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText("New Run")).toBeInTheDocument());
        expect(screen.getByText(/Last synced:/)).toBeInTheDocument();
        expect(screen.queryByText("Sync Now")).not.toBeInTheDocument();
    });
  });
});
