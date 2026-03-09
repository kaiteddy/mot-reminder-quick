import "dotenv/config";
import { getDb } from "../server/db";
import { autodataRequests } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function run() {
    const db = await getDb();
    if (!db) {
        console.error("No DB");
        process.exit(1);
    }

    // 1. Insert a new job into the queue
    console.log("Inserting a test job into autodataRequests queue...");
    const [insertRes] = await db.insert(autodataRequests).values({
        endpoint: "/w2/api/engine-oil/TOY43021?v=5c1542c252dd2c6f7e257b2dd19f2c09390a570f&language=en-gb",
        status: "pending"
    });

    const jobId = insertRes.insertId;
    console.log(`Inserted Job ID: ${jobId}. Now waiting for the Chrome Extension Drone to pick it up...`);

    // 2. Poll the db to see when status changes to completed
    let attempts = 0;
    while (attempts < 15) { // wait up to ~30 seconds
        const row = await db.select()
            .from(autodataRequests)
            .where(eq(autodataRequests.id, jobId));

        if (row.length === 0) {
            console.log("Job vanished?");
            break;
        }

        const job = row[0];
        if (job.status === "completed") {
            console.log("\n====== DRONE SUCCESS! ======\n");
            console.log("The Chrome Extension successfully fetched the Autodata API completely invisibly and posted the result back to Vercel!");
            console.log("JSON Length:", JSON.stringify(job.resultData).length);
            console.log("Preview:\n", JSON.stringify(job.resultData, null, 2).substring(0, 500) + "...");
            process.exit(0);
        } else if (job.status === "failed") {
            console.log("\n====== DRONE FAILED! ======\n");
            console.log("Error from drone:", job.errorMessage);
            process.exit(1);
        } else if (job.status === "processing") {
            process.stdout.write(" [Processing...] ");
        } else {
            process.stdout.write(".");
        }

        attempts++;
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log("\nDrone did not respond in time. Let's make sure it is updated and running.");
    process.exit(0);
}

run();
