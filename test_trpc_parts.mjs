import 'dotenv/config';

async function run() {
    const vrmRes = await fetch('http://localhost:3000/api/trpc/omnipart.lookupVrm?batch=1', {
        method: 'POST', body: JSON.stringify({'0': {'json': {'vrm': 'NG57YXT', 'token': 'auto'}}}), headers: {'Content-Type': 'application/json'}
    }).then(r => r.json());
    
    const vehicleId = vrmRes[0].result?.data?.json?.vehicleId;
    console.log("Got vehicleId:", vehicleId);
    
    if(!vehicleId) return;

    const partsRes = await fetch('http://localhost:3000/api/trpc/omnipart.getPartsInfo?batch=1', {
        method: 'POST', body: JSON.stringify({'0': {'json': {'vehicleId': vehicleId, 'vrm': 'NG57YXT', 'categorySlug': 'brake-pads', 'token': 'auto'}}}), headers: {'Content-Type': 'application/json'}
    }).then(r => r.json());
    
    console.log("Parts result (brake pads):", JSON.stringify(partsRes[0].result?.data?.json?.products?.slice(0, 5) || partsRes, null, 2));

    const partsRes2 = await fetch('http://localhost:3000/api/trpc/omnipart.getPartsInfo?batch=1', {
        method: 'POST', body: JSON.stringify({'0': {'json': {'vehicleId': vehicleId, 'vrm': 'NG57YXT', 'categorySlug': 'engine-oil', 'token': 'auto'}}}), headers: {'Content-Type': 'application/json'}
    }).then(r => r.json());

    console.log("Parts result (engine oil):", JSON.stringify(partsRes2[0].result?.data?.json?.products?.slice(0, 5) || partsRes2, null, 2));
}
run();
