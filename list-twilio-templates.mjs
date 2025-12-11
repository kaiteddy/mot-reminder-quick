import 'dotenv/config';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

async function listTemplates() {
  try {
    const url = 'https://content.twilio.com/v1/Content';
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Error fetching templates:');
      console.error(JSON.stringify(errorData, null, 2));
      return;
    }

    const data = await response.json();
    console.log('✅ All Content Templates:\n');
    
    if (data.contents && data.contents.length > 0) {
      data.contents.forEach((template, index) => {
        console.log(`${index + 1}. ${template.friendly_name}`);
        console.log(`   SID: ${template.sid}`);
        console.log(`   Language: ${template.language}`);
        console.log(`   Created: ${template.date_created}`);
        
        if (template.types && template.types['twilio/text']) {
          const body = template.types['twilio/text'].body;
          const preview = body.length > 100 ? body.substring(0, 100) + '...' : body;
          console.log(`   Body: ${preview.replace(/\n/g, ' ')}`);
        }
        
        if (template.variables) {
          console.log(`   Variables:`, template.variables);
        }
        console.log('');
      });
    } else {
      console.log('No templates found.');
    }
    
    console.log(`\nTotal templates: ${data.contents ? data.contents.length : 0}`);
  } catch (error) {
    console.error('❌ Exception:', error.message);
  }
}

console.log('🔍 Listing all Twilio Content Templates...\n');
console.log(`Account SID: ${accountSid}\n`);

listTemplates();
