# macOS LAN service

The launch service reads its ignored environment file from
`~/Library/Application Support/RNR Next/.env.lan` and starts the current project
on `0.0.0.0:3000`. Keep credentials out of this repository.

The environment file must define the normal application settings and a
persistent gallery directory, for example:

```bash
GALLERY_STORAGE_DIR="$HOME/Library/Application Support/RNR Next/gallery"
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

Back up the PostgreSQL database and the complete `GALLERY_STORAGE_DIR` before a
gallery import or application migration. Restore them as one matching pair.
Do not copy credentials into support logs or screenshots.
