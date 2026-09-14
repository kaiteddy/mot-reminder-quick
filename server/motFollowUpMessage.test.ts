/**
 * The MOT follow-up WhatsApp: which approved template, its three variables, and the text we log. Pure.
 */
import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { FOLLOW_UP_TEMPLATES, followUpMessage } from "../shared/motFollowUpMessage";

// Tuesday 15/09/2026, 09:00 in the UK.
const NOW = new Date("2026-09-15T08:00:00Z");
const car = (motExpiryDate: string) => ({ customerName: "Sam Patel", registration: "AO70 KWR", motExpiryDate });

describe("followUpMessage", () => {
  it("uses the expired template once the MOT's UK day has passed", () => {
    const m = followUpMessage(car("2026-09-14T00:00:00Z"), NOW);
    expect(m.isExpired).toBe(true);
    expect(m.templateSid).toBe(FOLLOW_UP_TEMPLATES.expired.sid);
    expect(m.text).toContain("Hi Sam Patel, this is ELI MOTORS in Hendon. Our records show the MOT on AO70 KWR ran out on 14 September 2026.");
    expect(m.text).not.toContain("{{");
  });

  it("still says 'runs out' on the day itself", () => {
    const m = followUpMessage(car("2026-09-15T00:00:00Z"), NOW);
    expect(m.isExpired).toBe(false);
    expect(m.templateSid).toBe(FOLLOW_UP_TEMPLATES.due.sid);
    expect(m.text).toContain("the MOT on AO70 KWR runs out on 15 September 2026 and we have not seen it booked yet.");
  });

  it("goes by the UK clock, not the server's", () => {
    // London midnight stored as an instant is 23:00 the day before in UTC.
    expect(followUpMessage(car("2026-09-23T23:00:00Z"), NOW).variables["3"]).toBe("24 September 2026");
    expect(followUpMessage(car("2026-09-15T00:00:00Z"), new Date("2026-09-15T22:30:00Z")).isExpired).toBe(false); // 23:30 UK
    expect(followUpMessage(car("2026-09-15T00:00:00Z"), new Date("2026-09-15T23:30:00Z")).isExpired).toBe(true);  // 00:30 UK next day
  });

  it("passes exactly the three variables the approved templates take", () => {
    for (const expiry of ["2026-09-01T00:00:00Z", "2026-09-20T00:00:00Z"]) {
      expect(Object.keys(followUpMessage(car(expiry), NOW).variables)).toEqual(["1", "2", "3"]);
    }
    for (const t of Object.values(FOLLOW_UP_TEMPLATES)) expect(t.body.match(/\{\{\d\}\}/g)?.sort()).toEqual(["{{1}}", "{{2}}", "{{3}}"]);
  });

  it("keeps customer text as typed", () => {
    expect(followUpMessage({ ...car("2026-09-01T00:00:00Z"), customerName: "Mr $1 Smith" }, NOW).text).toContain("Hi Mr $1 Smith,");
  });
});

describe("the follow-up send", () => {
  const sms = fs.readFileSync(path.resolve(import.meta.dirname, "smsService.ts"), "utf8");
  const send = sms.slice(sms.indexOf("export async function sendUrgentFollowUpWithTemplate"));
  const body = send.slice(0, send.indexOf("\n}\n"));

  it("takes its template, variables and wording only from shared/motFollowUpMessage.ts", () => {
    expect(body).toContain("followUpMessage(");
    expect(body).not.toMatch(/HX[0-9a-f]{32}/);
    expect(body).not.toContain("TWILIO_URGENT_");
  });

  it("never goes back to the old marketing templates", () => {
    for (const oldSid of ["HXe190fe9ce0c696e1631a32319f8eb783", "HXd3903b97116a1967f51c87a233a052c6"]) {
      expect(sms).not.toContain(oldSid);
    }
  });
});
