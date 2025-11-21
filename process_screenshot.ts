/**
 * Script to process screenshot and run MOT checks on all registrations
 */
import { invokeLLM } from "./server/_core/llm";
import { getMOTHistory, getLatestMOTExpiry } from "./server/motApi";
import { getVehicleDetails } from "./server/dvlaApi";

const imageUrl = "https://files.manuscdn.com/user_upload_by_module/session_file/105027644/HNLuDESgDRqjiRVS.png";

console.log("Processing screenshot...\n");

// Step 1: Extract reminders from screenshot using LLM vision
const response = await invokeLLM({
  messages: [
    {
      role: "system",
      content: "You are a data extraction assistant. Extract MOT and service reminders from screenshots of reminder lists.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Extract all reminders from this screenshot. For each reminder, extract: type (MOT or Service), dueDate (in YYYY-MM-DD format), registration, customerName, customerEmail, customerPhone, vehicleMake, vehicleModel. Return as JSON array.",
        },
        {
          type: "image_url",
          image_url: {
            url: imageUrl,
          },
        },
      ],
    },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "reminders_extraction",
      strict: true,
      schema: {
        type: "object",
        properties: {
          reminders: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["MOT", "Service"] },
                dueDate: { type: "string" },
                registration: { type: "string" },
                customerName: { type: "string" },
                customerEmail: { type: "string" },
                customerPhone: { type: "string" },
                vehicleMake: { type: "string" },
                vehicleModel: { type: "string" },
              },
              required: ["type", "dueDate", "registration"],
              additionalProperties: false,
            },
          },
        },
        required: ["reminders"],
        additionalProperties: false,
      },
    },
  },
});

const content = response.choices[0]?.message?.content;
if (!content) {
  console.error("No response from LLM");
  process.exit(1);
}

const parsed = JSON.parse(content as string);
const reminders = parsed.reminders || [];

console.log(`Extracted ${reminders.length} reminders\n`);

// Step 2: Run MOT checks on each registration
console.log("Running MOT checks on all registrations...\n");

for (const reminder of reminders) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`Registration: ${reminder.registration}`);
  console.log(`Type: ${reminder.type}`);
  console.log(`Due Date: ${reminder.dueDate}`);
  console.log(`Customer: ${reminder.customerName || "N/A"}`);
  console.log(`Vehicle: ${reminder.vehicleMake || "N/A"} ${reminder.vehicleModel || "N/A"}`);
  
  // Fetch MOT history
  try {
    const [motData, dvlaData] = await Promise.all([
      getMOTHistory(reminder.registration).catch((err) => {
        console.log(`  MOT API Error: ${err.message}`);
        return null;
      }),
      getVehicleDetails(reminder.registration).catch((err) => {
        console.log(`  DVLA API Error: ${err.message}`);
        return null;
      }),
    ]);
    
    if (motData) {
      const motExpiry = getLatestMOTExpiry(motData);
      console.log(`\nMOT Information:`);
      console.log(`  Make: ${motData.make || "N/A"}`);
      console.log(`  Model: ${motData.model || "N/A"}`);
      console.log(`  Colour: ${motData.primaryColour || "N/A"}`);
      console.log(`  Fuel Type: ${motData.fuelType || "N/A"}`);
      
      if (motExpiry) {
        const daysUntilExpiry = Math.floor((motExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        console.log(`  MOT Expiry: ${motExpiry.toISOString().split('T')[0]}`);
        console.log(`  Days Until Expiry: ${daysUntilExpiry}`);
        
        if (daysUntilExpiry < 0) {
          console.log(`  ⚠️  STATUS: EXPIRED ${Math.abs(daysUntilExpiry)} days ago`);
        } else if (daysUntilExpiry <= 30) {
          console.log(`  ⚠️  STATUS: DUE SOON`);
        } else {
          console.log(`  ✅ STATUS: Valid`);
        }
      }
      
      if (motData.motTests && motData.motTests.length > 0) {
        console.log(`  Total MOT Tests: ${motData.motTests.length}`);
        const latestTest = motData.motTests[0];
        console.log(`  Latest Test: ${latestTest?.testResult} on ${latestTest?.completedDate}`);
        if (latestTest?.odometerValue) {
          console.log(`  Mileage: ${latestTest.odometerValue} ${latestTest.odometerUnit}`);
        }
      }
    }
    
    if (dvlaData) {
      console.log(`\nDVLA Information:`);
      console.log(`  Tax Status: ${dvlaData.taxStatus || "N/A"}`);
      console.log(`  Tax Due Date: ${dvlaData.taxDueDate || "N/A"}`);
    }
    
    if (!motData && !dvlaData) {
      console.log(`  ❌ Vehicle not found in MOT or DVLA databases`);
    }
    
  } catch (error: any) {
    console.error(`  Error checking MOT: ${error.message}`);
  }
}

console.log(`\n${"=".repeat(80)}`);
console.log(`\nProcessing complete! Checked ${reminders.length} vehicles.`);
