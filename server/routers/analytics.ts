
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
        
    getFinancialStats: publicProcedure
        .query(async ({ ctx }) => {
            const { getDb } = await import("../db");
            const db = await getDb();
            if (!db) {
                throw new Error("Database not available");
            }
            
            const { serviceHistory } = await import("../../drizzle/schema");
            
            // 1. Fetch all docs with 'SI' (Sales Invoice) or 'SR' (Sales Receipt) to calculate revenue
            // Since it's ~33k rows, pulling just dateCreated/dateIssued and totalGross is very fast
            const docs = await db
                .select({
                    dateIssued: serviceHistory.dateIssued,
                    dateCreated: serviceHistory.dateCreated,
                    totalGross: serviceHistory.totalGross,
                    docType: serviceHistory.docType
                })
                .from(serviceHistory)
                .where(
                    sql`${serviceHistory.docType} = 'SI' OR ${serviceHistory.docType} = 'SR'`
                );
                
            let totalRevenue = 0;
            const nowReal = new Date();
            let latestDate = 0;

            for (const doc of docs) {
                const docDate = doc.dateIssued || doc.dateCreated;
                if (!docDate) continue;
                const ms = new Date(docDate).getTime();
                if (ms > latestDate) latestDate = ms;
            }

            // Time travel dashboard "now" to the edge of the dataset if the data is stale
            const now = (latestDate > 0 && latestDate < nowReal.getTime() - 3 * 24 * 60 * 60 * 1000) 
                 ? new Date(latestDate) 
                 : nowReal;
                 
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();
            
            // Helpful boundaries
            const lastWeekStart = new Date(now);
            lastWeekStart.setDate(lastWeekStart.getDate() - 14);
            
            const thisWeekStart = new Date(now);
            thisWeekStart.setDate(thisWeekStart.getDate() - 7);
            
            const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            
            const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
            const thisYearStart = new Date(now.getFullYear(), 0, 1);
            
            let revenueThisWeek = 0;
            let revenueLastWeek = 0;
            
            let revenueThisMonth = 0;
            let revenueLastMonth = 0;
            
            let revenueThisYear = 0;
            let revenueLastYear = 0;
            
            // For charting
            const monthlyChartDataMap = new Map<string, number>();
            const yearlyChartDataMap = new Map<string, number>();
            
            for (const doc of docs) {
                // Prefer dateIssued, fallback to dateCreated
                const docDate = doc.dateIssued || doc.dateCreated;
                if (!docDate) continue;
                
                const val = parseFloat(doc.totalGross as any) || 0;
                totalRevenue += val;
                
                const dateObj = new Date(docDate);
                const year = dateObj.getFullYear();
                const month = dateObj.getMonth();
                
                // Yearly
                if (year === currentYear) revenueThisYear += val;
                if (year === currentYear - 1) revenueLastYear += val;
                
                // Monthly
                if (dateObj >= thisMonthStart) revenueThisMonth += val;
                if (dateObj >= lastMonthStart && dateObj < thisMonthStart) revenueLastMonth += val;
                
                // Weekly
                if (dateObj >= thisWeekStart) revenueThisWeek += val;
                if (dateObj >= lastWeekStart && dateObj < thisWeekStart) revenueLastWeek += val;
                
                // Chart mappings
                const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
                monthlyChartDataMap.set(monthKey, (monthlyChartDataMap.get(monthKey) || 0) + val);
                
                const yearKey = `${year}`;
                yearlyChartDataMap.set(yearKey, (yearlyChartDataMap.get(yearKey) || 0) + val);
            }
            
            // Format chart data
            const monthlyChartData = Array.from(monthlyChartDataMap.entries())
                .map(([date, revenue]) => ({ date, revenue }))
                .sort((a, b) => a.date.localeCompare(b.date));
                
            const yearlyChartData = Array.from(yearlyChartDataMap.entries())
                .map(([year, revenue]) => ({ year, revenue }))
                .sort((a, b) => a.year.localeCompare(b.year));
                
            // Safe division for percentages
            const wowChange = revenueLastWeek > 0 ? ((revenueThisWeek - revenueLastWeek) / revenueLastWeek) * 100 : 0;
            const momChange = revenueLastMonth > 0 ? ((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100 : 0;
            const yoyChange = revenueLastYear > 0 ? ((revenueThisYear - revenueLastYear) / revenueLastYear) * 100 : 0;
            
            return {
                totalRevenue,
                revenueThisWeek,
                revenueLastWeek,
                wowChange,
                revenueThisMonth,
                revenueLastMonth,
                momChange,
                revenueThisYear,
                revenueLastYear,
                yoyChange,
                monthlyChartData,
                yearlyChartData
            };
        }),
});
