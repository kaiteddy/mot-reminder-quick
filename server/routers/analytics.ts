
import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { reminderLogs, customerMessages } from "../../drizzle/schema";
import { sql, desc, gte, lte, and } from "drizzle-orm";

export const analyticsRouter = router({
    getStats: publicProcedure
        .query(async ({ ctx }) => {
            const { getDb } = await import("../db");
            const db = await getDb();
            if (!db) {
                throw new Error("Database not available");
            }

            // 1. Total Sent (All time)
            const [sentResult] = await db
                .select({ count: sql<number>`count(*)` })
                .from(reminderLogs)
                .where(sql`${reminderLogs.status} = 'sent' OR ${reminderLogs.status} = 'delivered' OR ${reminderLogs.status} = 'read'`);

            const totalSent = sentResult?.count || 0;

            // 2. Total Replies (All time)
            const [replyResult] = await db
                .select({ count: sql<number>`count(*)` })
                .from(customerMessages);

            const totalReplies = replyResult?.count || 0;

            // 3. Response Rate
            const responseRate = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0;

            // 4. Estimated Cost (All time)
            // Assuming £0.05 per message sent (SMS/WhatsApp avg)
            const COST_PER_MSG = 0.05;
            const totalCost = totalSent * COST_PER_MSG;


            // 5. Daily Stats (Last 30 Days)
            // Fetch raw rows to avoid GROUP BY strict mode issues across different SQL envs
            // Performance impact is negligible for 30 days of text logs.

            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const sentLogs = await db
                .select({
                    sentAt: reminderLogs.sentAt
                })
                .from(reminderLogs)
                .where(gte(reminderLogs.sentAt, thirtyDaysAgo));

            const receivedMsgs = await db
                .select({
                    receivedAt: customerMessages.receivedAt
                })
                .from(customerMessages)
                .where(gte(customerMessages.receivedAt, thirtyDaysAgo));

            // Aggregate in Memory
            const statsMap = new Map<string, { sent: number, received: number }>();

            // Initialize last 30 days with 0
            for (let i = 0; i < 30; i++) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                statsMap.set(dateStr, { sent: 0, received: 0 });
            }

            // Count Sent
            for (const log of sentLogs) {
                if (!log.sentAt) continue;
                const d = new Date(log.sentAt);
                const dateStr = d.toISOString().split('T')[0];
                if (statsMap.has(dateStr)) {
                    const s = statsMap.get(dateStr)!;
                    s.sent++;
                }
            }

            // Count Received
            for (const msg of receivedMsgs) {
                if (!msg.receivedAt) continue;
                const d = new Date(msg.receivedAt);
                const dateStr = d.toISOString().split('T')[0];
                if (statsMap.has(dateStr)) {
                    const s = statsMap.get(dateStr)!;
                    s.received++;
                }
            }

            // (Aggregation logic moved above)

            // Convert to array and sort
            const dailyStats = Array.from(statsMap.entries()).map(([date, stats]) => ({
                date,
                sent: stats.sent,
                received: stats.received,
                cost: stats.sent * COST_PER_MSG
            })).sort((a, b) => a.date.localeCompare(b.date));

            return {
                totalSent,
                totalReplies,
                responseRate,
                totalCost,
                dailyStats
            };
        }),
});
