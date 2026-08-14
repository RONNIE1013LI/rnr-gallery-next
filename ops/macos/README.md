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
