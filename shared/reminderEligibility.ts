/**
 * Can this car be sent an MOT reminder? The ONE rule. The server applies it before every send
 * (reminders.sendWhatsApp, the failed-send retry) and the MOT Reminders page applies it to what it
 * lists and counts.
 *
 * Why one place: on 11/09/2026 the MOT Reminders page listed 93 cars whose reminders were switched
 * off and 137 cars on trade accounts. The page had its own copy of the rule and the server's send
 * check had another, so Send refused cars the page was counting as due. A reason added here is
 * refused on send and left off the page together. server/guards/reminderRules.test.ts fails the
 * build if either side stops using this.
 */
export type ReminderBlock = "opted_out" | "trade" | "reminders_off";

export type RemindableCar = {
  customerName?: string | null;
  customerOptedOut?: number | boolean | null;
  /** customers.noVehicleReminders — "Mark as trade" on the customer page. */
  customerTrade?: number | boolean | null;
  registration?: string | null;
  remindersOff?: number | boolean | null;
  remindersOffReason?: string | null;
};

/** Every reason this car can't be reminded, strongest first. Empty means it can be. */
export function reminderBlocks(car: RemindableCar): ReminderBlock[] {
  const blocks: ReminderBlock[] = [];
  if (car.customerOptedOut) blocks.push("opted_out");
  if (car.customerTrade) blocks.push("trade");
  if (car.remindersOff) blocks.push("reminders_off");
  return blocks;
}

export const isRemindable = (car: RemindableCar) => reminderBlocks(car).length === 0;

/** What staff are told when they try to send anyway. */
export function reminderBlockMessage(car: RemindableCar, block: ReminderBlock): string {
  const name = car.customerName || "This customer";
  switch (block) {
    case "opted_out":
      return `Customer ${name} has opted out of messages. They can opt back in by replying START.`;
    case "trade":
      return `${name} is a trade account - per-vehicle reminders are switched off for them.`;
    case "reminders_off":
      return `Reminders are switched off for ${car.registration || "this car"}${car.remindersOffReason ? ` — ${car.remindersOffReason}` : ""}. Turn them back on from the vehicle page to send.`;
  }
}
