# Galileosky Protocol Parser Fix (2026-07-07)

## Backup location

Original files before this change:

`backend/src/services/backups/pre-protocol-fix-20260707/`

See `README.md` in that folder to restore.

## Changes made

| Area | Before | After |
|------|--------|-------|
| **CRC16-Modbus** | Disabled (`// testing`) | Enabled via `validateChecksum` (disable with `VALIDATE_CHECKSUM=false`) |
| **Multi-record packets** | Heuristic split on raw `0x20` bytes | Sequential tag parsing + protocol record boundaries (`0x10`+`0x20` or second `0x20`) |
| **Unknown tags** | Skip 1 byte (offset drift) | End current record; skip tag safely in stream |
| **Extension packets** | ACK only, data discarded | Queued and parsed as tag stream (`parseMainPacket`) |
| **TCP `app.js`** | Extension `continue` before parse | Extension packets queued like main packets |

## New files

- `backend/src/services/galileoskyRecordStream.js` — record boundary helpers
- `backend/src/services/backups/pre-protocol-fix-20260707/` — backup snapshot

## Deploy

```bash
cd /opt/linuxParser2
git pull   # after push
pm2 restart gali-parse
pm2 logs gali-parse --lines 50
```

If CRC rejects valid devices (rare), temporarily set in `env.production`:

```env
VALIDATE_CHECKSUM=false
```

Then capture a failing packet hex from logs and report.

## Not in this phase

- TCP buffer race / ACK-before-save (transport layer — separate fix)
- Compressed packet format wiring
- XTEA encryption
- Full extended CAN tag encyclopedia
