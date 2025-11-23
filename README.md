# Strava Sync

A full-stack Cloudflare Workers application that acts as a caching layer for public Strava data. It allows multiple users to connect their Strava accounts, fetches their profile and activities, and stores them in a Cloudflare D1 database for efficient access.

## Features

-   **Multi-User Support**: Connects multiple Strava accounts using OAuth 2.0.
-   **Data Sync**: Fetches and caches athlete profiles and activities (paginated).
-   **Frontend**: A React Single Page Application (SPA) embedded directly in the Worker.
    -   **Setup**: Configure Strava API credentials (Client ID/Secret).
    -   **Dashboard**: View connected users.
    -   **User Detail**: View profile, sync status, and list of activities. Trigger manual syncs.
-   **Backend**: Cloudflare Worker with D1 Database (SQLite).
    -   **Auth**: Handles OAuth code exchange and token management.
    -   **API**: REST endpoints for fetching users, activities, and triggering syncs.

## Architecture

-   **Runtime**: Cloudflare Workers
-   **Database**: Cloudflare D1 (SQLite)
-   **Frontend**: React + Vite (Static assets served via Worker)
-   **Testing**: Vitest (Backend with `better-sqlite3` mock, Frontend with `@testing-library/react`)

### Project Structure

-   `src/`: Backend Worker code.
    -   `worker.ts`: Main entry point and router.
    -   `auth.ts`: OAuth handlers (`/api/auth/*`).
    -   `sync.ts`: Sync logic and data retrieval endpoints (`/api/users/*`).
    -   `db.ts`: D1 database access layer.
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
-   **Security**: Strava Access and Refresh tokens are stored in D1 but never exposed to the frontend API.
