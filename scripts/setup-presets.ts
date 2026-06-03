import "dotenv/config";
import mysql from "mysql2/promise";
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
await c.query(`CREATE TABLE IF NOT EXISTS descriptionPresets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  category VARCHAR(100),
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX description_presets_title_idx (title)
)`);
const [cnt]:any = await c.query("SELECT COUNT(*) n FROM descriptionPresets");
if (cnt[0].n === 0) {
  const seed: [string,string,string][] = [
    ["Full Service","Carried Out Full Service\n- Replaced engine oil and filter\n- Checked/replaced air filter and spark plugs as required\n- Inspected front and rear brakes\n- Checked all fluid levels and topped up as necessary\n- Checked drive belts, hoses and exterior lighting\n- Road tested vehicle (see report for any advisories)","Service"],
    ["Interim Service","Carried Out Interim Service\n- Replaced engine oil and filter\n- Topped up all under-bonnet fluid levels\n- Checked brakes, tyres and lighting\n- Road tested vehicle","Service"],
    ["MOT Test","Carry Out MOT Test","MOT"],
    ["Front Brakes - Pads & Discs","Supplied and fitted front brake pads and discs\n- Removed and inspected braking components\n- Cleaned and freed brake calipers\n- Fitted new pads and discs\n- Road tested and checked operation","Brakes"],
    ["Diagnostic Investigation","Carried Out Diagnostic Investigation\n- Performed full fault code scan\n- Investigated reported fault and confirmed cause\n- Provided findings and recommended repairs","Diagnostic"],
    ["Cambelt / Timing Belt","Replaced Timing Belt\n- Removed ancillary components for access\n- Fitted new timing belt, tensioner and idlers\n- Reset timing and refitted components\n- Checked operation and road tested","Engine"],
    ["Air Conditioning Service","Carried Out Air Conditioning Service\n- Evacuated and recharged system\n- Checked for leaks and correct operation\n- Replaced refrigerant and lubricant to specification","Air Con"],
  ];
  await c.query("INSERT INTO descriptionPresets (title, body, category) VALUES ?", [seed]);
  console.log("seeded", seed.length, "presets");
} else console.log("presets exist:", cnt[0].n);
await c.end();
