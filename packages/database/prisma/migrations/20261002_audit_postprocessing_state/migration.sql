-- Core measurement completion is distinct from optional/derived outputs.
ALTER TABLE "AuditJob" ADD COLUMN "postprocessing" JSONB;
