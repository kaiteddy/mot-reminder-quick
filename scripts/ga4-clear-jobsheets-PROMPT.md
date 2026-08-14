# Task: delete 27 completed job sheets in GA4

You are working in **Garage Assistant 4 (GA4)** — the FileMaker runtime inside the Parallels
Windows VM — using the `garage-assistant` tools. Everything below happens in the real live
system, so read the safety rules before touching anything.

## What and why

27 job sheets are finished but were never closed. Each one has either already been invoiced, or
Adam has confirmed there is nothing to bill. They are being deleted **in GA4** so they stop
reappearing in the workshop app, which mirrors GA4 and re-imports anything still present.

**Delete the job sheet only. Never touch an invoice, and never touch a job sheet not on the list.**

## Safety rules — read before starting

1. **One activation per dialog.** A confirm/delete dialog fires on a single click. The `click`
   tool repeats by default — always pass `single: true` on any dialog button. Double-firing has
   permanently destroyed a record here before.
2. **Screenshots can be stale.** A dialog that still looks open may already have been actioned.
   Take a fresh screenshot before deciding a click didn't land. Never click again "to be sure".
3. **Double-click to enter fields or fire controls.** A single click only selects; keystrokes
   typed before the field is active buffer and flush later, which corrupts input.
4. **NumLock must be OFF** in the guest before typing. With it on, Home/End arrive as digits and
   text gets garbled.
5. **In the "Open Document" dialog, never press Return.** It fires *Delete + View* even when the
   selection ring is on Ignore.
6. **If anything is unexpected, stop and report.** Do not improvise, do not retry a destructive
   action, do not carry on to the next record. An unfinished run is fine; a wrong deletion is not.

## The 27 job sheet numbers

```
92464  92726  92857  92866  92867  92876  92901  92941  92958
92979  93008  93010  93014  93017  93022  93025  93027  93053
93063  93068  93099  93100  93105  93146  93211  93222  93227
```

**Do NOT delete 90923.** It is deliberately excluded — it has an unexplained £250 discrepancy
and is still under review. If you find yourself about to action 90923, stop.

## Procedure, per job sheet

1. Go to the **Job Sheets** module.
2. Search for the job sheet **number** (not the registration — registrations repeat across cars).
3. **Verify before deleting.** Confirm all three:
   - the document type is a **Job Sheet**, not an invoice
   - the **number matches exactly** the one you searched
   - the number is **on the list above**

   If the search returns no match, record it as "not found" and move on — that is a normal
   outcome, it may already have been cleared.
4. Delete it using GA4's own delete action, confirming **once**.
5. **Verify after deleting.** Search the same number again. It should return no result. Record
   the outcome as `deleted`, `not found`, or `failed`.

Work through them **in batches of five**, and pause after each batch to report progress. Do not
run all 27 unattended.

## What to report back

A line per job sheet:

```
92464  deleted
92726  deleted
92857  not found (already cleared)
92866  FAILED — <what you saw>
```

Then a summary: how many deleted, how many not found, how many failed, and anything that looked
wrong. If you stopped early, say exactly where you got to so the rest can be picked up.

## If you are unsure at any point

Stop and say so. Deleting the wrong record here is not recoverable from inside GA4, and the
workshop app's copy would be deleted afterwards to match — so a mistake would remove the only
remaining trace of a job. Reporting an incomplete run is always the right call.
