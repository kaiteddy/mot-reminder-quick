import { Router } from "express";
import { getDb } from "../db";
import { autodataRequests } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export const autodataRouter = Router();

autodataRouter.get("/engine-oils", async (req, res) => {
  const { vrm, mid } = req.query;
  if (!vrm || !mid) {
    return res.status(400).json({ success: false, error: "Missing vrm or mid" });
  }

  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // 1. Insert Job
    const [insertRes] = await db.insert(autodataRequests).values({
      endpoint: `/w2/api/engine-oil/${mid}?v=5c1542c252dd2c6f7e257b2dd19f2c09390a570f&language=en-gb`,
      status: "pending"
    });

    const jobId = insertRes.insertId;

    // 2. Poll Database for Completion (Max 15 seconds)
    let attempts = 0;
    while (attempts < 15) {
      const row = await db.select()
        .from(autodataRequests)
        .where(eq(autodataRequests.id, jobId));

      if (row.length === 0) break;

      const job = row[0];
      if (job.status === "completed") {
        return res.json({ success: true, data: job.resultData });
      } else if (job.status === "failed") {
        return res.status(500).json({ success: false, error: job.errorMessage || "Drone failed fetching data" });
      }

      attempts++;
      await new Promise(r => setTimeout(r, 1000));
    }

    res.status(504).json({ success: false, error: "Drone proxy timed out waiting for browser extension." });

  } catch (err: any) {
    console.error("Autodata drone request failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

autodataRouter.get("/resolve-vrm", async (req, res) => {
  const { vrm } = req.query;
  if (!vrm) {
    return res.status(400).json({ success: false, error: "Missing vrm" });
  }

  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // We do a Native Fetch directly to Autodata via the drone polling proxy to lookup by VRM
    // Example: /w2/api/vehicles?vrm=RE71VOD
    const [insertRes] = await db.insert(autodataRequests).values({
      endpoint: `/w2/api/vehicles?vrm=${encodeURIComponent(vrm as string)}`,
      status: "pending"
    });

    const jobId = insertRes.insertId;

    // 2. Poll Database for Completion (Max 15 seconds)
    let attempts = 0;
    while (attempts < 15) {
      const row = await db.select()
        .from(autodataRequests)
        .where(eq(autodataRequests.id, jobId));

      if (row.length === 0) break;

      const job = row[0];
      if (job.status === "completed") {
        return res.json({ success: true, data: job.resultData });
      } else if (job.status === "failed") {
        return res.status(500).json({ success: false, error: job.errorMessage || "Drone failed fetching VRM resolution" });
      }

      attempts++;
      await new Promise(r => setTimeout(r, 1000));
    }

    res.status(504).json({ success: false, error: "Drone proxy timed out waiting for browser extension." });

  } catch (err: any) {
    console.error("Autodata drone VRM request failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
