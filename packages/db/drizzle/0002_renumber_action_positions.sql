--> Data-only migration: no schema change.
--> 0001 backfilled action positions partitioned by project, which is right for
--> a project's own action list but wrong for every cross-project list (Now,
--> Waiting, Organise) — the per-project sequences interleave and the combined
--> order looks arbitrary. Renumber into a single global sequence by creation
--> order, which preserves relative order inside each project as well.
UPDATE "actions" a
SET "position" = r.rn
FROM (
  SELECT "id", row_number() OVER (ORDER BY "created_at") * 1000 AS rn
  FROM "actions"
) r
WHERE a."id" = r."id";
