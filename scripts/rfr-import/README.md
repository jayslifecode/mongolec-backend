# Rally for Rangers — content import

One-time (re-runnable, idempotent) scripts that populate the `rally-for-rangers` tenant with
real content: rally media, rallies, riders/rangers, team, testimonials and impact stories.

Spec: `rally-for-rangers-website/docs/superpowers/specs/2026-10-06-rfr-launch-design.md`
§1.2–1.6. Plan: `.../docs/superpowers/plans/2026-10-06-rfr-launch-plan.md` Stream B2.

## Prerequisites

1. **Database schema** — the `rallies`, `stories`, `rangers`, `participants`,
   `participant_rallies` and `team_members` tables (and the `Rally.isPlaceholder`,
   `Participant.slug`/`Participant.honoraryTitle` columns — the script also backfills a slug
   for any pre-existing row before adding the unique index, so it's safe to run against a DB
   that already has rider rows) must exist. Run the idempotent SQL once per environment:
   ```bash
   psql "$DATABASE_URL" -f create-rally-tables.sql
   ```
2. **Env vars** (already in `.env` locally): `DATABASE_URL`, `B2_ENDPOINT`, `B2_REGION`,
   `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY`, `B2_BUCKET_NAME`, `B2_PUBLIC_URL`.
3. **Local resize/convert tools** (no sharp/ImageMagick on this box): macOS `sips` (built in)
   and `/opt/local/bin/cwebp`.
4. **Source assets**: `~/Downloads/Website 2/` (the Drive export — rally photos, portraits,
   staff bios, site section images). `data/website-data-2026-09.json` is the fresh spreadsheet
   dump (sheets: Rallies, Staff Members, Testimonials, Riders by Rally); `data/staff-bios.txt`
   holds the 7 core team bios.
5. A **tenant** named `rally-for-rangers` must already exist in the target DB.

## Run order

Each script supports `--print` (offline mapping preview, no DB/network), no flag (dry run —
reads the DB/manifest and prints the plan, writes nothing), and `--commit` (applies it).
`upload-images.ts` instead uses `--dry-run` / `--limit N` since it has no DB step.

```bash
# 1. Images -> B2. ~291 unique objects (~378 source files, de-duplicated by destination key).
#    Idempotent: HEAD-checks each key and skips it if already uploaded. Writes
#    data/image-manifest.json, which every later importer reads.
npx ts-node -r dotenv/config scripts/rfr-import/upload-images.ts

# 2. Rallies — cost, status, hero/gallery from the manifest, Mongolia 2027 + International 2027.
npx ts-node -r dotenv/config scripts/rfr-import/import-rallies.ts --commit

# 3. Riders & rangers — portraits from the manifest, re-uploads WordPress-only photos into B2.
#    Merges every " - YYYY" sighting of the same rider into one Participant (slug + rally
#    links derived from both the sheet and the Rider_Portraits folders), deletes any stale
#    rfr-rider-* rows the merge supersedes, and prints a summary (merged count, riders per
#    rally, top riders by rally count).
npx ts-node -r dotenv/config scripts/rfr-import/import-people.ts --commit

# 4. Team — 7 core members from staff-bios.txt + spreadsheet board/advisor rows (inactive).
npx ts-node -r dotenv/config scripts/rfr-import/import-team.ts --commit

# 5. Testimonials — featuredImage from the manifest.
npx ts-node -r dotenv/config scripts/rfr-import/import-testimonials.ts --commit

# 6. Impact stories — mongolia-2023, mongolia-2024, mongolia-2025, peru-2026.
npx ts-node -r dotenv/config scripts/rfr-import/import-stories.ts --commit
```

Run steps 2–6 in this exact order: rallies must exist before people/stories can link to them,
and every importer after step 1 reads `data/image-manifest.json`.

### Prod

From inside the backend container (prod `DATABASE_URL` is already in its env):

```bash
docker cp create-rally-tables.sql mongolec-postgres:/tmp/ && \
  docker exec mongolec-postgres psql -U mongolec -d mongolec -f /tmp/create-rally-tables.sql

docker exec -it mongolec-backend sh -c '
  npx ts-node scripts/rfr-import/upload-images.ts &&
  npx ts-node scripts/rfr-import/import-rallies.ts --commit &&
  npx ts-node scripts/rfr-import/import-people.ts --commit &&
  npx ts-node scripts/rfr-import/import-team.ts --commit &&
  npx ts-node scripts/rfr-import/import-testimonials.ts --commit &&
  npx ts-node scripts/rfr-import/import-stories.ts --commit
'
```

`upload-images.ts` skips any B2 key that already exists, so re-running it in prod after the
local run is safe and cheap (every object will already be there).

`import-people.ts` also walks the `Rider_Portraits/<Year>_<Country>[...]` Drive folders
(default `~/Downloads/Website 2/Rider_Portraits`, override with `RFR_PORTRAITS_DIR`) to derive
rally links the sheet doesn't have (bhutan-2022, peru-2022, namibia-2023, mongolia-2019,
mongolia-2023, bhutan-2024). If that path doesn't exist inside the container the scan is
skipped silently (no error) and those links are simply not created — either mount/copy the
`Rider_Portraits` folder into the container and set `RFR_PORTRAITS_DIR`, or run
`import-people.ts --commit` once locally (as above) and replicate the resulting
`participants`/`participant_rallies` rows into prod instead of re-deriving them there.

## Layout

- `upload-images.ts` — walks the Drive export, resizes (`sips`) + converts to WebP (`cwebp`),
  uploads to B2, writes `data/image-manifest.json`.
- `import-rallies.ts`, `import-people.ts`, `import-team.ts`, `import-testimonials.ts`,
  `import-stories.ts` — one importer per content type.
- `lib/` — shared, mostly-pure helpers (name/slug normalisation, rider-sighting merging,
  portrait-folder scanning, manifest IO, asset discovery, image processing, B2 upload,
  portrait matching, WordPress-photo re-upload, story block types/builders) used by more than
  one importer, kept small and unit-testable (`lib/*.test.ts`, run via `npm test`).
- `data/` — spreadsheet dumps (`website-data-2026-09.json`, `staff-bios.txt`) and the
  generated `image-manifest.json`.

## Hero curation (2026-10-07)
`data/hero-overrides.json` promotes a specific manifest key to be a rally's hero and drops non-photo assets (maps, flyers, posters). `import-rallies.ts` applies it automatically; edit the JSON and re-run `import-rallies.ts --commit`. Note: `Namibia_2023_02.webp` in the Drive folder was converted to `Namibia_2023_02.png` beside it because `sips` cannot read WebP sources; the uploader ignores `.webp` inputs.
