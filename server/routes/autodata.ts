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

    // Immediately return the job ID so the frontend can poll without hitting Vercel's 10s Serverless timeout
    return res.json({ success: true, jobId });

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
    // Example: /w2/api/vehicles/search/gb/RE71VOD?v=...
    const [insertRes] = await db.insert(autodataRequests).values({
      endpoint: `/w2/api/vehicles/search/gb/${encodeURIComponent(vrm as string)}?v=5c1542c252dd2c6f7e257b2dd19f2c09390a570f&language=en-gb`,
      status: "pending"
    });

    const jobId = insertRes.insertId;

    // Immediately return the job ID so the frontend can poll without hitting Vercel's 10s Serverless timeout
    return res.json({ success: true, jobId });

  } catch (err: any) {
    console.error("Autodata drone VRM request failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint for the React frontend to poll the database for Drone completion
autodataRouter.get("/job/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const row = await db.select()
      .from(autodataRequests)
      .where(eq(autodataRequests.id, Number(id)));

    if (row.length === 0) {
      return res.status(404).json({ success: false, error: "Job not found in queue" });
    }

    const job = row[0];

    if (job.status === "completed") {
      return res.json({ success: true, status: "completed", data: job.resultData });
    } else if (job.status === "failed") {
      // Send 200 OK but success=false so the frontend can parse the exact error message gracefully
      return res.json({ success: false, status: "failed", error: job.errorMessage || "Drone failed fetching Autodata" });
    } else {
      // Pending
      return res.json({ success: true, status: job.status });
    }

  } catch (err: any) {
    console.error("Autodata job poll failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
