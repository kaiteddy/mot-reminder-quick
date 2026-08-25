// Single source of truth for the MOT bay's bookable slots. Shared by the
// Appointments calendar (client/src/pages/Appointments.tsx) and the top-bar
// "Book MOT" quick-book dropdown (client/src/components/BookMOTButton.tsx) so
// the two can never disagree about what a valid MOT slot is or which slots exist.
export const MOT_BAY_ID = "mot-bay";

export type Slot = { id: string; label: string; start: string; end: string };

// One MOT tester → one car per hour, 08:30–17:00 with a 13:00–14:00 lunch.
export const MOT_SLOTS: Slot[] = [
  { id: "08:30", label: "08:30 - 09:30", start: "08:30", end: "09:30" },
  { id: "09:30", label: "09:30 - 10:30", start: "09:30", end: "10:30" },
  { id: "11:00", label: "11:00 - 12:00", start: "11:00", end: "12:00" },
  { id: "12:00", label: "12:00 - 13:00", start: "12:00", end: "13:00" },
  { id: "14:00", label: "14:00 - 15:00", start: "14:00", end: "15:00" },
  { id: "15:00", label: "15:00 - 16:00", start: "15:00", end: "16:00" },
  { id: "16:00", label: "16:00 - 17:00", start: "16:00", end: "17:00" },
];
