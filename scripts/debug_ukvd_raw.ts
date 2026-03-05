import { fetchUKVDData } from "../server/ukvd";

async function main() {
    const vrm = process.argv[2] || "RE71VOD";
    const data = await fetchUKVDData(vrm);
    console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
