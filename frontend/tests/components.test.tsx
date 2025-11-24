import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import Dashboard from "../src/Dashboard";
import Setup from "../src/Setup";
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

      await waitFor(() => expect(screen.getByText("No users connected yet.")).toBeInTheDocument());
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
      expect(screen.getByText("No users connected yet.")).toBeInTheDocument();

      consoleSpy.mockRestore();
    });

    it("redirects to setup if config missing (500)", async () => {
        // Setup initial load
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => [],
        });

        render(
            <BrowserRouter>
            <Dashboard />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText("Connect New Strava User")).toBeInTheDocument());

        // Click Connect
        fetchMock.mockResolvedValueOnce({
            status: 500
        });

        fireEvent.click(screen.getByText("Connect New Strava User"));

        await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/setup"));
    });

    it("redirects to login if config ok", async () => {
        // Setup initial load
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => [],
        });

        // Mock window.location
        const originalLocation = window.location;
        Object.defineProperty(window, 'location', {
          value: { href: '' },
          writable: true
        });

        try {
            render(
                <BrowserRouter>
                <Dashboard />
                </BrowserRouter>
            );

            await waitFor(() => expect(screen.getByText("Connect New Strava User")).toBeInTheDocument());

            // Click Connect
            fetchMock.mockResolvedValueOnce({
                status: 200,
                type: "basic" // fetch mock default
            });

            fireEvent.click(screen.getByText("Connect New Strava User"));

            await waitFor(() => expect(window.location.href).toBe("/api/auth/login"));
        } finally {
            // Restore window.location
            Object.defineProperty(window, 'location', {
                value: originalLocation,
                writable: true
            });
        }
    });
  });

  describe("Setup", () => {
    it("submits config successfully", async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      render(
        <BrowserRouter>
          <Setup />
        </BrowserRouter>
      );

      fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "123" } });
      fireEvent.change(screen.getByLabelText("Client Secret"), { target: { value: "abc" } });
      fireEvent.click(screen.getByText("Save & Continue"));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith("/api/config", expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ client_id: "123", client_secret: "abc" })
        }));
        expect(navigateMock).toHaveBeenCalledWith("/");
      });
    });

    it("displays error on failure", async () => {
         fetchMock.mockResolvedValueOnce({
             ok: false,
             json: async () => ({ error: "Invalid config" })
         });

         const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});

        render(
            <BrowserRouter>
            <Setup />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "123" } });
        fireEvent.change(screen.getByLabelText("Client Secret"), { target: { value: "abc" } });
        fireEvent.click(screen.getByText("Save & Continue"));

        await waitFor(() => expect(alertMock).toHaveBeenCalledWith("Failed to save configuration"));

        alertMock.mockRestore();
    });
  });

  describe("UserDetail", () => {
    it("UserDetail syncs data", async () => {
        // 1. Initial User Fetch
        fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ strava_id: 123, firstname: "Test", lastname: "User", profile_pic: "" }),
        });
        // 2. Initial Activities Fetch
        fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
        });

        render(
        <BrowserRouter>
            <UserDetail />
        </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText("Sync Now")).toBeInTheDocument());

        // 3. Sync Call (Page 1)
        fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ synced: 10, complete: true }),
        });

        // 4. Refresh User (after sync)
        fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ strava_id: 123, firstname: "Test", lastname: "User", profile_pic: "", last_synced_at: 100 }),
        });

        // 5. Refresh Activities (after sync)
        fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 1, name: "New Run", type: "Run", distance: 1000, start_date: "2023-01-01" }],
        });

        fireEvent.click(screen.getByText("Sync Now"));

        await waitFor(() => expect(screen.getByText(/Sync Complete!/)).toBeInTheDocument());
        await waitFor(() => expect(screen.getByText("New Run")).toBeInTheDocument());
    });

    it("Handles sync error", async () => {
         // 1. Initial User Fetch
         fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ strava_id: 123, firstname: "Test", lastname: "User", profile_pic: "" }),
         });
         // 2. Initial Activities Fetch
         fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => [],
         });

         render(
             <BrowserRouter>
                 <UserDetail />
             </BrowserRouter>
         );

         await waitFor(() => expect(screen.getByText("Sync Now")).toBeInTheDocument());

         // 3. Sync Call (Error)
         fetchMock.mockResolvedValueOnce({
             ok: false,
             statusText: "Server Error"
         });

         fireEvent.click(screen.getByText("Sync Now"));

         await waitFor(() => expect(screen.getByText("Error: Server Error")).toBeInTheDocument());
    });
  });
});
