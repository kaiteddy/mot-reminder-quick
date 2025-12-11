import 'dotenv/config';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const templateSids = [
  'HX127c47f8a63b992d80b43943394a1740', // MOT reminder
  'HXac307a9bd92b65df83038c2b2a3eeeff', // Service reminder
];

async function checkTemplate(sid) {
  try {
    const url = `https://content.twilio.com/v1/Content/${sid}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`\n❌ Error fetching template ${sid}:`);
      console.error(JSON.stringify(errorData, null, 2));
      return null;
    }

    const data = await response.json();
    console.log(`\n✅ Template ${sid}:`);
    console.log(JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error(`\n❌ Exception fetching template ${sid}:`, error.message);
    return null;
  }
}

async function main() {
  console.log('🔍 Checking Twilio Content Templates...\n');
  console.log(`Account SID: ${accountSid}`);
  console.log(`Auth Token: ${authToken ? '***' + authToken.slice(-4) : 'NOT SET'}`);
  
  for (const sid of templateSids) {
    await checkTemplate(sid);
  }
}

main();
