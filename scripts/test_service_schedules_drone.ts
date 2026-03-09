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
  while (attempts < 45) {
    const row = await db.select()
        .from(autodataRequests)
        .where(eq(autodataRequests.id, jobId));
    
    if (row.length === 0) break;
    const job = row[0];
    
    if (job.status === "completed") {
        console.log("SUCCESS!");
        const out = typeof job.resultData === 'string' ? JSON.parse(job.resultData) : job.resultData;
        if (out && out.rawHtml) {
            console.log("Returned HTML. Printing first 1000 chars:");
            console.log(out.rawHtml.substring(0, 1000));
        } else {
            console.log("Returned JSON:");
            console.log(JSON.stringify(out, null, 2));
        }
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
  const mid = "OPL16080";
  const endpointsToTry = [
    `/w1/service-schedules/${mid}?v=5c1542c&language=en-gb`, // This should return the UI HTML correctly now because we fixed background.js parsing!
    `/w2/api/service-schedule/${mid}?v=5c...`, // singular
    `/w2/api/vehicles/${mid}/obd-location`
  ];

  for (const ep of endpointsToTry) {
     const success = await runJob(ep);
     if (success) {
        console.log(`Endpoint ${ep} worked!`);
     }
  }
  process.exit(0);
}

run();
