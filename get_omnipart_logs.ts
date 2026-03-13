// Just mock a client call explicitly against localhost:3000 to see what TRPC returns today!
import { execSync } from 'child_process';
const resp = execSync(`curl -s "http://localhost:3000/api/trpc/reminders.lookupParts?input=%7B%220%22%3A%7B%22vehicleId%22%3A%224204369%22%2C%22vrm%22%3A%22RE16%20RWP%22%2C%22categorySlug%22%3A%22Brake%20Discs%22%2C%22isCustomSearch%22%3Atrue%2C%22token%22%3A%22auto%22%7D%7D"`, { encoding: 'utf-8'} );
console.log(resp.slice(0, 1000));
