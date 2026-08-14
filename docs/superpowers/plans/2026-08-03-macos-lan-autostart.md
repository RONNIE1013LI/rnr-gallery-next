# macOS LAN Autostart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current R&R Gallery Next.js platform and its local PostgreSQL dependency start automatically after every macOS login and remain reachable at `http://192.168.4.199:3000` on the local network.

**Architecture:** A repository-owned shell script starts Docker Desktop when needed, waits for Docker and PostgreSQL, then replaces itself with the Next.js LAN development server. A per-user LaunchAgent runs that script at login and restarts it after unexpected exits. Secrets stay in a mode-600 file outside Git.

**Tech Stack:** macOS launchd, zsh, Docker Desktop, PostgreSQL 16, Node.js, Next.js

## Global Constraints

- Use the fixed LAN origin `http://192.168.4.199:3000`.
- Do not modify WordPress, application pages, checkout logic, payment logic, or database schema.
- Do not expose environment secrets in Git or logs.
- Keep the current Next.js development worktree as the served application.
- Do not commit changes.

---

### Task 1: Repository-owned startup script

**Files:**
- Create: `ops/macos/start-lan-server.zsh`

**Interfaces:**
- Consumes: `RNR_NEXT_ENV_FILE`, Docker container `rnr-next-payment-test`, fixed project path.
- Produces: a foreground Next.js process listening on `0.0.0.0:3000`.

- [ ] **Step 1: Create the script with strict error handling**

The script must source a mode-600 environment file, start Docker Desktop when necessary, wait at most 180 seconds for Docker, ensure `rnr-next-payment-test` is running, wait at most 90 seconds for PostgreSQL, and finally run:

```zsh
exec /usr/local/bin/npm run dev -- --hostname 0.0.0.0 --port 3000
```

- [ ] **Step 2: Validate shell syntax**

Run:

```bash
zsh -n ops/macos/start-lan-server.zsh
```

Expected: exit code 0 and no output.

### Task 2: Per-user environment and LaunchAgent

**Files:**
- Create: `~/Library/Application Support/RNR Next/.env.lan`
- Create: `~/Library/LaunchAgents/com.rnr.next-platform.plist`
- Create: `~/Library/Logs/RNRNext/`

**Interfaces:**
- Consumes: fixed IP `192.168.4.199`, local database at `127.0.0.1:55443`.
- Produces: login-time and crash-restarted service `com.rnr.next-platform`.

- [ ] **Step 1: Write the private environment file**

Set the database URL, fixed authentication and payment-return origins, local test shipping and payments flags, and a stable randomly generated authentication secret. Apply mode `600`.

- [ ] **Step 2: Make PostgreSQL restart with Docker**

Run:

```bash
docker update --restart unless-stopped rnr-next-payment-test
```

Expected: Docker reports `rnr-next-payment-test`.

- [ ] **Step 3: Install and validate the LaunchAgent**

The plist must use `RunAtLoad`, restart on unsuccessful exit, set the project working directory, and write stdout/stderr under `~/Library/Logs/RNRNext/`. Validate with:

```bash
plutil -lint "$HOME/Library/LaunchAgents/com.rnr.next-platform.plist"
```

Expected: `OK`.

### Task 3: Simulated reboot verification

**Files:**
- Inspect: `~/Library/Logs/RNRNext/stdout.log`
- Inspect: `~/Library/Logs/RNRNext/stderr.log`

**Interfaces:**
- Consumes: installed LaunchAgent and Docker restart policy.
- Produces: verified HTTP access through loopback and the fixed LAN IP.

- [ ] **Step 1: Stop the temporary foreground development server**

Stop only the existing Next.js process bound to port 3000.

- [ ] **Step 2: Bootstrap the LaunchAgent**

Run `launchctl bootstrap` for the current GUI user and `launchctl kickstart -k` the service.

- [ ] **Step 3: Verify service ownership and HTTP connectivity**

Confirm launchd shows the service running, then require HTTP 200 from:

```text
http://127.0.0.1:3000/
http://192.168.4.199:3000/
```

- [ ] **Step 4: Verify automatic recovery**

Terminate the launchd-managed Next.js process, wait for launchd to replace it with a different PID, and confirm both URLs still return HTTP 200.
