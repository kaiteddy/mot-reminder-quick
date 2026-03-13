import 'dotenv/config';
import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('./dev.db');
db.get('SELECT value FROM app_settings WHERE key = "omnipart_jwt_token"', async (err, row) => {
    if (!row) return console.log("NO TOKEN");
    
    let token = row.value;
    const clean = token.replace(/[\n\r]| /g, '');
    const headers = { Authorization: clean };
    
    const res = await fetch("https://api.omnipart.eurocarparts.com/storefront/categories/air-conditioning", { headers });
    const data = await res.json();
    console.log("CATEGORY:", Object.keys(data));
    console.log("CHILDREN:", data.children?.length);
    console.log("ID:", data['@id']);
    
    const catId = data['@id']?.split('/').pop();
    console.log("CatId:", catId);
    
    if (catId) {
        const prodRes = await fetch(`https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/${catId}?`, { headers });
        const prodData = await prodRes.json();
        console.log("PROD:", Object.keys(prodData));
        console.log("HYDRA MEM:", prodData['hydra:member']?.length);
    }
});
