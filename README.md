# Strava Sync

A Cloudflare Worker that serves cached Strava data from a D1 database through a read-only, CORS-enabled API and a small React dashboard. The data is written by a local sync job ([sync/](sync/README.md)) that holds the Strava credentials and runs on a timer, so no Strava secrets live in Cloudflare.

## Features

-   **Sync job** (`sync/`): runs locally (bun), refreshes the Strava token, fetches new activities and writes them to D1 over the D1 HTTP API, then purges the Cloudflare cache.
-   **Frontend**: A React Single Page Application (SPA) embedded directly in the Worker.
    -   **Dashboard**: View synced athletes.
    -   **User Detail**: View profile, last sync time, charts and activities.
-   **Backend**: Cloudflare Worker with D1 Database (SQLite).
    -   **API**: read-only `GET /api/users`, `/api/users/:id`, `/api/users/:id/activities`; any other method gets 405.

## Architecture

-   **Runtime**: Cloudflare Workers
-   **Database**: Cloudflare D1 (SQLite)
-   **Frontend**: React + Vite (Static assets served via Worker)
-   **Testing**: Vitest (Backend with `better-sqlite3` mock, Frontend with `@testing-library/react`)

### Project Structure

-   `src/`: Backend Worker code.
    -   `worker.ts`: Main entry point and router.
    -   `sync.ts`: data retrieval endpoints (`/api/users/*`).
    -   `db.ts`: D1 database access layer.
-   `sync/`: local sync job, its systemd units and [setup](sync/README.md).
-   `migrations/`: one-off changes to the live D1 database.
-   `frontend/`: React application.
    -   `src/`: React components and logic.
    -   `vite.config.ts`: Frontend build configuration.
-   `tests/`: Backend integration tests.
-   `schema.sql`: Database schema definition.

## Dependencies

-   **Backend**: `@cloudflare/workers-types`, `better-sqlite3` (for testing).
-   **Frontend**: `react`, `react-dom`, `react-router-dom`.
-   **Build/Dev**: `vite`, `wrangler`, `vitest`, `typescript`.

## Build & Deploy

### Prerequisites
-   Node.js >= 20
-   Cloudflare Wrangler

### Commands

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Run Tests**:
    ```bash
    npm run test
    ```

3.  **Local Development**:
    ```bash
    npm run dev
    ```
    This builds the frontend and starts the local Worker environment.

4.  **Deploy**:
    ```bash
    npm run deploy
    ```

## Implementation Details

-   **Asset Serving**: The frontend is built into `frontend/dist`. The Worker serves these static assets using Cloudflare's native `[assets]` binding. API requests (`/api/*`) are intercepted and handled by the Worker logic. SPA routing is supported by falling back to `index.html` for unknown routes.
-   **Security**: The Worker holds no credentials and accepts no writes. The Strava client secret, refresh token and the Cloudflare API token used for writes stay on the machine running the sync job.
