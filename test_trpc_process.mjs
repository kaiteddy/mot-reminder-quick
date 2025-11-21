import fetch from 'node-fetch';

const imageUrl = 'https://files.manuscdn.com/user_upload_by_module/session_file/105027644/HNLuDESgDRqjiRVS.png';

// tRPC batch format
const response = await fetch('http://localhost:3001/api/trpc/reminders.processImage?batch=1', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    "0": {
      imageUrl: imageUrl
    }
  })
});

const result = await response.json();
console.log(JSON.stringify(result, null, 2));
