#!/usr/bin/env bash
# Nightly MongoDB backup for Linux hosts (cron / systemd timer).
#   - MONGODB_URI must come from the environment (secret store); never stored here.
#   - Optional: BACKUP_DIR (default /var/backups/hms), RETENTION_DAYS (35), MONTHLY_KEEP (12),
#               BACKUP_UPLOAD_CMD (e.g. 'aws s3 cp' or 'rclone copyto') to ship the archive off-host.
# cron:  0 2 * * *  /opt/hms/scripts/backup.sh >> /var/log/hms-backup.log 2>&1
set -euo pipefail

: "${MONGODB_URI:?MONGODB_URI is not set}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hms}"
RETENTION_DAYS="${RETENTION_DAYS:-35}"
MONTHLY_KEEP="${MONTHLY_KEEP:-12}"

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M)"
archive="$BACKUP_DIR/hms-$stamp.gz"

mongodump --uri="$MONGODB_URI" --gzip --archive="$archive" --quiet
echo "Backup written: $archive ($(du -h "$archive" | cut -f1))"

if [[ -n "${BACKUP_UPLOAD_CMD:-}" ]]; then
  # shellcheck disable=SC2086
  $BACKUP_UPLOAD_CMD "$archive" "${BACKUP_UPLOAD_TARGET:?set BACKUP_UPLOAD_TARGET}/hms-$stamp.gz"
fi

# Retention: dailies older than RETENTION_DAYS (except 1st-of-month), monthlies older than MONTHLY_KEEP months.
find "$BACKUP_DIR" -name 'hms-*.gz' -type f | while read -r f; do
  day="$(basename "$f" | sed -E 's/^hms-([0-9]{8})-.*/\1/')"
  age=$(( ( $(date +%s) - $(date -d "$day" +%s) ) / 86400 ))
  if [[ "${day:6:2}" == "01" ]]; then
    (( age > MONTHLY_KEEP * 31 )) && rm -f "$f" && echo "Pruned $f"
  else
    (( age > RETENTION_DAYS )) && rm -f "$f" && echo "Pruned $f"
  fi
done
exit 0
