# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Overview

A fullstack deployment platform that clones Git repositories, automatically generates appropriate Dockerfiles, builds Docker images, and deploys containers with real-time log streaming via Socket.IO. Built with Bun, Express, and Dockerode.

## Development Commands

### Setup and Installation
```bash
bun install
```

### Running the Application
```bash
# Production mode
bun run start

# Development mode with hot reload
bun run dev
```

### Environment Variables
Required in `.env`:
- `EMAIL_USER` - Gmail address for notifications
- `EMAIL_PASS` - Gmail app password (not regular password)
- `DOCKER_BUILDKIT=1` - Enables BuildKit for Docker

## Architecture

### Core Components

**Entry Point** (`src/index.ts`)
- Express server with Socket.IO integration
- Docker connection configured for Windows (localhost:2375)
- Real-time container log streaming via WebSocket
- Handles `stream-logs` events with container name to stream Docker logs to clients

**API Routes** (`src/routes/route.ts`)
- `POST /api/clone` - Clone repository and generate Dockerfile
- `POST /api/docker` - Build image and create container

**Controllers**

1. **GitHub Controller** (`src/controller/github.ts`)
   - Clones repositories to `./repos/{projectName}`
   - Auto-detects project type from `package.json` dependencies
   - Generates framework-specific Dockerfiles:
     - Next.js: Multi-stage build with production optimization
     - React/Vite: Build stage + nginx serving
     - Express: Simple Node runtime with entrypoint detection
     - Laravel: PHP-FPM with extensions
     - Generic Node: Fallback with auto-detected entrypoint
   - Creates `.dockerignore` with framework-specific exclusions

2. **Docker Controller** (`src/controller/docker.ts`)
   - Builds images using tar-fs streaming (excludes node_modules, .next, .git, dist, build)
   - Creates and starts containers with port 3000 exposed
   - Container naming: `{imagename}-{timestamp}`
   - Image tagging: `{imagename}:{timestamp}`
   - Sends desktop notifications and email alerts on success/failure
   - Tracks build time and reports in response

3. **Email Controller** (`src/controller/email.ts`)
   - Nodemailer integration for deployment notifications
   - Uses Gmail SMTP transport

### Docker Integration Notes

- **Windows Configuration**: Docker connection uses `host: "localhost", port: 2375` (Docker Desktop with TCP enabled)
- **Linux Alternative**: Uncomment `socketPath: "/var/run/docker.sock"` in `src/index.ts` and `src/controller/docker.ts`
- All containers expose port 3000 and bind to host port 3000
- Build process streams output to stdout for monitoring

### Socket.IO Real-Time Logging

- Event `stream-logs` with `{containername: string}` starts streaming
- Emits `container-logs` events with log data
- Emits `container-log-end` when stream ends
- Emits `container-log-error` on errors
- Previous streams are destroyed when new stream is requested

### Project Structure

```
src/
├── index.ts              # Express + Socket.IO server
├── routes/
│   └── route.ts          # API route definitions
└── controller/
    ├── github.ts         # Repository cloning and Dockerfile generation
    ├── docker.ts         # Image building and container management
    └── email.ts          # Email notification utility

repos/                    # Cloned repositories (auto-created)
```

## Important Patterns

### Error Handling
- All controllers send desktop notifications (node-notifier) on success/failure
- Email notifications sent to hardcoded address after operations
- Socket errors emit events back to client with error messages

### Dockerfile Generation
- Check `package.json.dependencies` to detect framework
- Laravel detected via `artisan` file existence
- Entrypoint extraction: prioritizes `package.json.main`, then parses `scripts.start` for node command

### File System Operations
- Repositories cloned to `./repos/{projectName}` relative to project root
- Dockerfile validation: checks existence before building
- Path normalization: Windows backslashes converted to forward slashes for Docker

## Development Notes

- Runtime: **Bun** (v1.2.10+)
- The project uses TypeScript but no explicit typecheck/lint scripts are defined
- Socket.IO connection logs all events for debugging
- Docker daemon must be running and accessible
- Gmail requires app-specific password (not account password) for email notifications
