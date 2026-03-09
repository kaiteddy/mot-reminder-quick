import "dotenv/config";
import { getDb } from "../server/db";
import { autodataRequests } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function runJob(endpoint: string) {
    const db = await getDb();
    if (!db) {
        console.error("No DB");
        process.exit(1);
    }

    console.log(`\nTesting ${endpoint} ...`);
    const [insertRes] = await db.insert(autodataRequests).values({
        endpoint,
        status: "pending"
    });

    const jobId = insertRes.insertId;

    let attempts = 0;
    while (attempts < 20) {
        const row = await db.select()
            .from(autodataRequests)
            .where(eq(autodataRequests.id, jobId));

        if (row.length === 0) break;
        const job = row[0];

        if (job.status === "completed") {
            console.log("SUCCESS! Got data:");
            console.log(JSON.stringify(job.resultData, null, 2).substring(0, 500));
            return true;
        } else if (job.status === "failed") {
            console.log("FAILED:", job.errorMessage);
            return false;
        }

        attempts++;
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
}

async function run() {
    const vrm = "RE71VOD";
    const endpointsToTry = [
        `/w2/api/vehicles?vrm=${vrm}`,
        `/w2/api/vehicles/vrm/${vrm}`,
        `/w2/api/vehicles/search?vrm=${vrm}`,
        `/w2/api/vehicles/search?registration=${vrm}`,
        `/w2/api/vrm/${vrm}`,
        `/v1/vehicles?vrm=${vrm}`
    ];

    for (const ep of endpointsToTry) {
        const ok = await runJob(ep);
        if (ok) break;
    }
    process.exit(0);
}

run();
