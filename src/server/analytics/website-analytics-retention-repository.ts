import { sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";

type Database = ReturnType<typeof getDatabase>;

export function createWebsiteAnalyticsRetentionRepository(database: Database) {
  return Object.freeze({
    async deleteBefore(input: Readonly<{ cutoff: Date; limit: number }>) {
      const result = await database.execute(sql`
        with candidates as (
          select sessions.id
          from website_analytics_sessions sessions
          where sessions.started_at < ${input.cutoff}
            and not exists (
              select 1
              from website_analytics_pageviews pageviews
              where pageviews.session_id = sessions.id
                and pageviews.occurred_at >= ${input.cutoff}
            )
          order by sessions.started_at, sessions.id
          for update skip locked
          limit ${input.limit}
        )
        delete from website_analytics_sessions sessions
        using candidates
        where sessions.id = candidates.id
        returning sessions.id
      `);
      return result.rowCount ?? result.rows.length;
    },
  });
}
