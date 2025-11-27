import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ActivityDetailModal from "../src/ActivityDetailModal";
import { Activity } from "../src/utils";

describe("ActivityDetailModal", () => {
  const mockActivity: Activity = {
    id: 1,
    strava_id: 123,
    name: "Test Run",
    type: "Run",
    start_date: "2023-10-01T10:00:00Z",
    distance: 5000,
    moving_time: 1500,
    elapsed_time: 1600,
    total_elevation_gain: 100,
    data_json: {
      average_speed: 3.3,
      max_speed: 4.5,
      average_watts: 200,
      kilojoules: 500,
      average_heartrate: 150,
      max_heartrate: 180,
    }
  };

  it("does not render when closed", () => {
    render(
      <ActivityDetailModal
        isOpen={false}
        onClose={() => {}}
        activity={mockActivity}
      />
    );
    expect(screen.queryByText("Test Run")).not.toBeInTheDocument();
  });

  it("renders activity details when open", () => {
    render(
      <ActivityDetailModal
        isOpen={true}
        onClose={() => {}}
        activity={mockActivity}
      />
    );
    expect(screen.getByText("Test Run")).toBeInTheDocument();
    expect(screen.getByText("5.00 km")).toBeInTheDocument(); // Distance
    expect(screen.getByText("11.9 km/h")).toBeInTheDocument(); // Speed
    expect(screen.getByText("150 bpm")).toBeInTheDocument(); // HR
  });

  it("handles missing data_json gracefully", () => {
    const minimalActivity: Activity = {
      ...mockActivity,
      data_json: undefined
    };

    render(
      <ActivityDetailModal
        isOpen={true}
        onClose={() => {}}
        activity={minimalActivity}
      />
    );
    expect(screen.getByText("Test Run")).toBeInTheDocument();
    expect(screen.getByText("5.00 km")).toBeInTheDocument();
    // Should not show HR or speed as they are in data_json
    expect(screen.queryByText("150 bpm")).not.toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onCloseMock = vi.fn();
    render(
      <ActivityDetailModal
        isOpen={true}
        onClose={onCloseMock}
        activity={mockActivity}
      />
    );

    fireEvent.click(screen.getByText("Close"));
    expect(onCloseMock).toHaveBeenCalled();
  });
});
