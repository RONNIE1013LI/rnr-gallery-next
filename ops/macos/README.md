# macOS LAN service

The launch service reads its ignored environment file from
`~/Library/Application Support/RNR Next/.env.lan` and starts the current project
on `0.0.0.0:3000`. Keep credentials out of this repository. The LAN review
service explicitly uses Webpack because the long-running Turbopack development
runtime can leave mobile browsers holding stale CSS hot-reload chunks.

The environment file must define the normal application settings, a persistent
gallery directory, and a persistent private customer-upload directory, for
example:

```bash
GALLERY_STORAGE_DIR="$HOME/Library/Application Support/RNR Next/gallery"
RNR_PRIVATE_UPLOAD_DIR="$HOME/Library/Application Support/RNR Next/private-uploads"
```

After changing code or the environment file, restart the service:

```bash
launchctl kickstart -k "gui/$(id -u)/com.rnr.next-platform"
```

Verify both the Mac and LAN URLs after every restart:

```bash
curl --fail http://127.0.0.1:3000/design-gallery
curl --fail http://192.168.4.199:3000/design-gallery
```

Create one verified recovery bundle before a gallery import, schema migration,
or release:

```bash
npm run backup:lan
```

The command creates an atomic timestamped directory under
`~/Library/Application Support/RNR Next/backups`. It contains a custom-format
PostgreSQL dump, the complete Design Gallery store, private customer uploads,
and SHA-256 checksums. It never overwrites an existing recovery point and does
not print the database URL. Keep the database, gallery, and private uploads as
one matching recovery set. Test restoration into a new empty database and new
directories before relying on a backup; never restore over the running database.

## Encrypted Production Blob recovery copy

Production Vercel Blob backups use `/Volumes/Data/RNR Gallery Backups` on the
authorised Time Capsule. Payloads and manifests are encrypted with AES-256-GCM
before the first write to the share. The encryption key and Production Blob
source token are read from macOS Keychain at runtime; never put them in this
repository or an environment file.

Install or update the independent operational runtime and daily 05:20
LaunchAgent after the Keychain entries and mount health have been verified:

```bash
npm run backup:blob:install
```

The installer builds a self-contained, versioned runtime under
`~/Library/Application Support/RNR Gallery/Backup`, verifies it before
activation, and points LaunchAgent only at that stable location. It does not
symlink to the repository or a worktree. Re-run the installer from verified
source whenever backup code changes; never edit the installed runtime by hand.

Operational commands after installation:

```bash
npm run backup:blob:status
npm run backup:blob:production
RNR_BLOB_BACKUP_DESTINATION="/Volumes/Data/RNR Gallery Backups" \
RNR_BLOB_RESTORE_CATEGORY=gallery \
RNR_BLOB_RESTORE_SOURCE_KEY="gallery/example.webp" \
RNR_BLOB_RESTORE_OUTPUT="/absolute/isolated/output.webp" \
npm run backup:blob:restore
```

The job is incremental and fail-closed. Unknown Blob prefixes stop the run. A
generation is committed only after both encrypted manifests and the encrypted
`COMPLETE` marker have been written and verified; only then is the encrypted
current-generation pointer changed. Gallery history is retained. Private backup
objects and manifests are removed after the source retention process has removed
the corresponding Production object, so the backup does not become a permanent
private-data archive.

All supported Production backup processes use the same macOS `lockf` advisory
lock under the installed runtime `state` directory. The kernel releases the
lock when the process exits, crashes, or the Mac restarts, so a stale lock file
cannot block future runs. The npm command and LaunchAgent both use the same
installed wrapper; the TypeScript Production command refuses to run when that
lock boundary is bypassed by verifying its actual process ancestry rather than
trusting an environment flag. A network call that stalls keeps the lock instead
of releasing it while a child might still be writing; terminate the scheduled
job before retrying. This backup destination is assigned to this Mac only; do
not run another writer against the same Time Capsule directory from a second
computer.

A restore must always target a new isolated local file; it never overwrites a
Production Blob object. Set `RNR_BLOB_RESTORE_RUN_ID` to restore a Gallery object
from a specific completed historical generation. Historical private-object
restore is intentionally refused; private restore is limited to the current
generation. Failed or partial scheduled runs write to the dedicated error log
and raise a local macOS notification.
