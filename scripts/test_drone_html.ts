import "dotenv/config";
import { getDb } from "../server/db";
import { autodataRequests } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function runJob(endpoint: string) {
    const db = await getDb();
    if (!db) {
        process.exit(1);
    }

    console.log(`\nTesting ${endpoint} ...`);
    const [insertRes] = await db.insert(autodataRequests).values({
        endpoint,
        status: "pending"
    });

    const jobId = insertRes.insertId;

    let attempts = 0;
    while (attempts < 60) {
        const row = await db.select()
            .from(autodataRequests)
            .where(eq(autodataRequests.id, jobId));

        if (row.length === 0) break;
        const job = row[0];

        if (job.status === "completed") {
            console.log("SUCCESS!");
            return job.resultData;
        } else if (job.status === "failed") {
            console.log("FAILED:", job.errorMessage);
            return null;
        }

        attempts++;
        await new Promise(r => setTimeout(r, 1000));
    }
    return null;
}

async function run() {
    const mid = "OPL16080";
    const url1 = `/w1/service-schedules/${mid}`;
    const url2 = `/w1/obd-locations/${mid}`;

    const res1 = await runJob(url1);
    if (res1 && typeof res1 === "object" && res1.rawHtml) {
        console.log("Service Schedules HTML length:", res1.rawHtml.length);
        const matches = res1.rawHtml.match(/href="w1\/service-schedules-intervals[^"]+"/g);
        console.log("Interval links found:", matches?.slice(0, 3));
    }

    const res2 = await runJob(url2);
    if (res2 && typeof res2 === "object" && res2.rawHtml) {
        console.log("OBD HTML length:", res2.rawHtml.length);
        const index = res2.rawHtml.indexOf("sc-fFlnrN");
        console.log("sc-fFlnrN index:", index);
        if (index > -1) {
            console.log("Surrounding code:", res2.rawHtml.substring(index - 50, index + 200));
        }
    } else if (res2) {
        console.log("OBD JSON:", res2);
    }

    process.exit(0);
}

run();
