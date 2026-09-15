import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  AROUND_JOB_DAYS, MAX_AGE_DAYS, ATTACH_MESSAGES, type OrderOption,
} from "../../shared/attachOrders";

/**
 * Parts orders that have not been put on a job yet, and putting them on one.
 *
 * Orders arrive from supplier email and are matched automatically ONLY when exactly one job
 * matches the registration. Everything else lands here for somebody to place by hand, which is
 * the common case rather than the exception: stock orders and counter buys carry no registration
 * at all, and a car that was in twice in a week is ambiguous on purpose — putting parts on the
 * wrong job puts a cost on the wrong customer's invoice, silently.
 */

function rows(result: any): any[] {
  return (result?.rows ?? result ?? []) as any[];
}

/** Who is doing this, for the audit trail. The table rejects a link with nobody recorded on it. */
function actor(ctx: any): string {
  return ctx?.user?.email || ctx?.user?.name || ctx?.user?.id || "";
}

export const partsOrdersRouter = router({
  /**
   * The dropdown for one job: every unplaced order within a year, best first.
   *
   * Ranked, NOT filtered. A counter purchase for a car that was never in the system still has to
   * be placeable, and a list that hides the answer is worse than a long one. The registration
   * decides the ORDER of the rows, never whether a row appears.
   */
  forJob: protectedProcedure
    .input(z.object({
      documentId: z.number().int().positive(),
      search: z.string().trim().max(60).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }): Promise<OrderOption[]> => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No database connection." });

      const search = input.search?.length ? input.search : null;

      const result: any = await db.execute(sql`
        WITH job AS (
          SELECT "id", "registration", "dateCreated", "dateIssued"
            FROM "serviceHistory" WHERE "id" = ${input.documentId}
        )
        SELECT o."id" AS "orderId", o."supplier", o."ref", o."orderedAt", o."netTotal",
               o."branch", o."typedRef",
               (SELECT count(*) FROM "partsOrderLine" l WHERE l."orderId" = o."id") AS "lineCount",
               CASE
                 WHEN o."vehicleRefNorm" <> ''
                  AND o."vehicleRefNorm" = upper(regexp_replace(COALESCE(j."registration",''), '[^A-Za-z0-9]', '', 'g'))
                   THEN 'same vehicle'
                 WHEN o."orderedAt" BETWEEN j."dateCreated" - (${String(AROUND_JOB_DAYS)} || ' days')::interval
                                        AND COALESCE(j."dateIssued", now()) + (${String(AROUND_JOB_DAYS)} || ' days')::interval
                   THEN 'ordered around this job'
                 ELSE 'recent'
               END AS "reason",
               round((abs(EXTRACT(EPOCH FROM (o."orderedAt" - j."dateCreated"))) / 86400)::numeric, 1) AS "daysApart"
          FROM "partsOrder" o CROSS JOIN job j
         WHERE o."documentId" IS NULL
           AND o."orderedAt" > now() - (${String(MAX_AGE_DAYS)} || ' days')::interval
           AND (${search}::text IS NULL
                OR o."ref" ILIKE '%' || ${search} || '%'
                OR o."typedRef" ILIKE '%' || ${search} || '%'
                OR o."supplier" ILIKE '%' || ${search} || '%'
                OR EXISTS (SELECT 1 FROM "partsOrderLine" l
                            WHERE l."orderId" = o."id"
                              AND (l."supplierPartNumber" ILIKE '%' || ${search} || '%'
                                   OR l."description" ILIKE '%' || ${search} || '%')))
         ORDER BY
           CASE
             WHEN o."vehicleRefNorm" <> ''
              AND o."vehicleRefNorm" = upper(regexp_replace(COALESCE(j."registration",''), '[^A-Za-z0-9]', '', 'g')) THEN 0
             WHEN o."orderedAt" BETWEEN j."dateCreated" - (${String(AROUND_JOB_DAYS)} || ' days')::interval
                                    AND COALESCE(j."dateIssued", now()) + (${String(AROUND_JOB_DAYS)} || ' days')::interval THEN 1
             ELSE 2
           END,
           abs(EXTRACT(EPOCH FROM (o."orderedAt" - j."dateCreated")))
         LIMIT ${input.limit}
      `);

      return rows(result).map((r) => ({
        orderId: Number(r.orderId),
        supplier: String(r.supplier),
        ref: String(r.ref),
        orderedAt: r.orderedAt ? new Date(r.orderedAt).toISOString() : null,
        netTotal: r.netTotal == null ? null : Number(r.netTotal),
        branch: r.branch ?? null,
        typedRef: r.typedRef ?? null,
        lineCount: Number(r.lineCount ?? 0),
        reason: r.reason,
        daysApart: r.daysApart == null ? null : Number(r.daysApart),
      }));
    }),

  /** Orders already on this job, so the picker can show what is there and offer to undo. */
  onJob: protectedProcedure
    .input(z.object({ documentId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No database connection." });

      const result: any = await db.execute(sql`
        SELECT o."id" AS "orderId", o."supplier", o."ref", o."orderedAt", o."netTotal",
               o."linkedBy", o."linkBasis",
               (SELECT count(*) FROM "partsOrderLine" l WHERE l."orderId" = o."id") AS "lineCount",
               (SELECT count(*) FROM "partsOrderLine" l
                 WHERE l."orderId" = o."id" AND l."serviceLineItemId" IS NOT NULL) AS "linesAttached"
          FROM "partsOrder" o
         WHERE o."documentId" = ${input.documentId}
         ORDER BY o."orderedAt" DESC NULLS LAST
      `);

      return rows(result).map((r) => ({
        orderId: Number(r.orderId),
        supplier: String(r.supplier),
        ref: String(r.ref),
        orderedAt: r.orderedAt ? new Date(r.orderedAt).toISOString() : null,
        netTotal: r.netTotal == null ? null : Number(r.netTotal),
        linkedBy: r.linkedBy ?? null,
        linkBasis: r.linkBasis ?? null,
        lineCount: Number(r.lineCount ?? 0),
        linesAttached: Number(r.linesAttached ?? 0),
      }));
    }),

  /**
   * Put an order on a job.
   *
   * The update applies only while the order is still unplaced, so two people on the same job do
   * not overwrite each other — the second is told instead.
   */
  attach: protectedProcedure
    .input(z.object({
      orderId: z.number().int().positive(),
      documentId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const who = actor(ctx);
      if (!who) throw new TRPCError({ code: "BAD_REQUEST", message: ATTACH_MESSAGES.noUser });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No database connection." });

      const result: any = await db.execute(sql`
        UPDATE "partsOrder"
           SET "documentId" = ${input.documentId}, "linkedAt" = now(), "linkedBy" = ${who},
               "linkBasis" = 'manual', "updatedAt" = now()
         WHERE "id" = ${input.orderId} AND "documentId" IS NULL
         RETURNING "id"
      `);

      if (rows(result).length === 0) {
        throw new TRPCError({ code: "CONFLICT", message: ATTACH_MESSAGES.alreadyTaken });
      }
      return { ok: true as const };
    }),

  /**
   * Take an order back off a job.
   *
   * An order on the WRONG job is worse than one on no job, so undo has to exist. Costs this order
   * put onto job lines are cleared with it — leaving them behind would keep a number whose origin
   * has just been removed. Only costs sourced from the order are touched: a figure somebody typed
   * in by hand is theirs, not ours to delete.
   */
  detach: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No database connection." });

      const cleared: any = await db.execute(sql`
        UPDATE "serviceLineItems" li
           SET "costNet" = NULL, "costSource" = NULL, "costSetAt" = NULL, "costSetBy" = NULL,
               "costSourceRef" = NULL, "supplierPartNumber" = NULL, "supplierName" = NULL
          FROM "partsOrderLine" l
         WHERE l."orderId" = ${input.orderId}
           AND li."id" = l."serviceLineItemId"
           AND li."costSource" = 'supplier-line'
         RETURNING li."id"
      `);

      await db.execute(sql`
        UPDATE "partsOrderLine"
           SET "serviceLineItemId" = NULL, "attachedAt" = NULL, "attachedBy" = NULL
         WHERE "orderId" = ${input.orderId}
      `);

      const result: any = await db.execute(sql`
        UPDATE "partsOrder"
           SET "documentId" = NULL, "linkedAt" = NULL, "linkedBy" = NULL, "linkBasis" = NULL,
               "updatedAt" = now()
         WHERE "id" = ${input.orderId}
         RETURNING "id"
      `);

      if (rows(result).length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: ATTACH_MESSAGES.gone });
      }
      return { ok: true as const, costsCleared: rows(cleared).length };
    }),
});
