ALTER TABLE "agent_grants" ADD COLUMN "can_publish" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_pairings" ADD COLUMN "can_publish" boolean DEFAULT false NOT NULL;