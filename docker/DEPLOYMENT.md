# DS423+ deployment and rollback

Release candidate: `sd3420625/mcpvault-gateway:0.17.1-sg4.2.1-r1`.
Do not deploy until the matching commit's complete Container verification and
Docker Hub release workflow has succeeded, including the publish job. Use its
immutable `sha-<12-character-commit>` tag or manifest digest when deploying.
Neither the original `0.17.1-sg4.2.1` nor `0.11.2` tag is overwritten.

## Evidence and scope

The 2026-11-05 diagnostic snapshot showed 713 `[MainThread]` zombies, 716 total
zombies, and Docker fork failures on 2026-10-30. The three MCPVault containers
had no init and no PID limit. Supergateway 4.2.1 starts a separate server for
`healthCheck=server`, caches the answer for 10 seconds, and stops the process
group with SIGTERM followed by a five-second SIGKILL escalation. Signalling a
process group does not reap adopted descendants. The previous shell -> Node
wrapper -> MCPVault launch chain permitted descendants to become orphans when
their parent and child were terminated together. Tini provides the missing
PID 1 reaper. `exec` and same-process CLI loading reduce orphan creation;
gateway-only health eliminates periodic server creation by default.

This supports the process-exhaustion diagnosis. A historical process listing
without PPIDs cannot attribute every zombie to a particular container, and it
does not by itself rule out every other cause of a NAS hang.

## Back up before any replacement

Use an authorized DSM/SSH session with Docker administrative access. Keep all
backup files on the NAS with mode 0700 directories / 0600 files: inspect JSON
can contain API keys. Do not upload these files to GitHub or CI artifacts.

1. Record current host uptime, `/proc/sys/kernel/pid_max`, thread count, zombie
   count, free memory, Docker/container status and resource usage. Verify the
   `pids` controller is available in `/proc/cgroups`. If it is unavailable,
   record that the PID cap is not enforced; do not claim it protects the NAS.
2. Export full `docker inspect` for `mcpvault-personal`, `mcpvault-share`, and
   `mcpvault-work`; export their image inspect, current logs, and any Compose
   project files / environment files. Record image IDs and RepoDigests.
3. Tag each current image ID with a unique local rollback tag and save those
   tagged images using `docker image save` to a backup tar after checking free
   disk space. Keep the existing containers for rollback, stopped and renamed
   only when each replacement is ready. Do not prune images or volumes.
4. Confirm a completed Synology snapshot or backup of all three Vaults. If no
   backup mechanism is available, stop the corresponding container and make a
   protected archive of its actual bind-mounted Vault before replacing it.
   Do not copy an active Vault and describe the copy as a consistent snapshot.

The diagnostic export recorded the following mapping; **fresh live inspect is
authoritative**, since the user may have changed it after the export:

| Container | Host port -> container port | Host bind -> container bind | User |
| --- | --- | --- | --- |
| mcpvault-work | 18001 -> 8000 | /volume1/import/note/工作笔记 -> /vault:rw | 1024:100 |
| mcpvault-share | 18002 -> 8000 | /volume1/import/note/共享笔记 -> /vault:rw | 1024:100 |
| mcpvault-personal | 18003 -> 8000 | /volume1/import/note/个人笔记 -> /vault:rw | 1024:100 |

Preserve all live environment, user/group, supplementary groups, networks,
restart/logging policy, secrets, mounts, ports, API key and Cloudflare settings.
Explicitly reset an old container's inherited entrypoint and health command to
the new image defaults: merely changing its image can preserve old overrides.
The new entrypoint is `/usr/bin/tini -g -- mcpvault-entrypoint`; health command
is exec-form `["CMD", "node", "/app/docker/healthcheck.mjs"]`.
Set `HEALTH_CHECK=gateway`, `pids_limit=256`, and a 20-second stop grace period.
Do not raise kernel PID limits to hide a leak. Do not add `privileged`, host PID
mode, or a Docker socket mount to these application containers.

## Replace one container at a time

Use the least disruptive order agreed for the current workload; default:
personal -> share -> work. Pull and inspect the new image before stopping any
service. Verify the immutable image revision, exact MCPVault 0.17.1 and
Supergateway 4.2.1 versions, and the expected linux/amd64 platform for DS423+.

For each container:

1. Complete and verify the backups above. Stop the old container gracefully,
   rename it to `<name>-rollback-<timestamp>`, and retain its image and mounts.
   Prevent automatic restart of the retained container while the replacement
   uses its ports; record the original restart policy for rollback.
2. Recreate with the fresh backed-up settings and the changes specified above.
   Do not remove volumes or edit any Vault note.
3. Verify live Docker inspect: correct ports/mounts/user, new image ID/revision,
   Tini entrypoint, health command, and PID limit. Confirm `/proc/1/comm` is
   `tini` inside the container. Check the actual container cgroup's `pids.max`
   / `pids.current` (v1 or v2) rather than assuming a CLI flag was enforced.
4. Wait for Docker healthy, then perform authenticated MCP initialize,
   `tools/list`, and a read-only directory listing / known note read. Check
   both the NAS port and the existing external HTTPS connector. Do not run
   `smoke-http.mjs` or `process-regression.mjs` on a production Vault: they are
   explicitly disposable test fixtures.
5. Sample process/thread/zombie counts before and after at least ten health
   intervals and several real MCP session disconnects. Counts must stabilize
   and zombies must return to zero. Check logs for fork failures and restart
   loops. Verify graceful stop/restart and repeat read-only MCP checks.
6. Only after these checks pass, continue to the next container. Keep a
   24-hour follow-up as outstanding until actually observed; do not call a
   five-minute sample a long-term stability result.

## Roll back a failed replacement

Stop and rename the failed replacement; keep its logs and inspect output.
Rename the retained old container back to the exact original name, restore its
recorded restart policy, start it, and repeat health plus read-only MCP checks.
It uses the original image ID and the same Vault binds. If the original
container was not retained, recreate from the protected inspect/Compose backup
and local rollback image tag or saved image tar.

The original 4.2.1 image may resume the leak: rollback restores availability,
not a proven process-reaping fix. Prefer a verified fixed image when possible.
The older `0.11.2` image remains an additional compatibility fallback only;
do not silently downgrade MCPVault or assume it has the same tools.

## Report actual execution

For each stage record the timestamp, commit, Actions URL, test result, image
tag/digest, backup location, old/new container IDs, mapping comparison, MCP
checks, PID/zombie samples and any rollback. Mark unavailable credentials,
failed builds, queued/running jobs, unpublished images, untested NAS targets,
and an unobserved 24-hour interval explicitly as incomplete.
