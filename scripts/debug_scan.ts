
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
    const { invokeLLM } = await import('../server/_core/llm');
    const imagePath = '/Users/service/.gemini/antigravity/brain/9cf752d5-567f-495d-bfd9-7beec7902184/uploaded_image_1768568645222.png';

    try {
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

        console.log('Invoking LLM with image...');

        const response = await invokeLLM({
            messages: [
                {
                    role: "system",
                    content: "You are a data extraction assistant. Extract all vehicle rows from the provided screenshot table. Look for 'Reg' or 'Registration' columns. Return a JSON array of items. Important: Extract the row even if the MOT Date is 'No data' or missing. Default type to 'MOT' if unsure. Treat 'Reg' column values like '01D68212' as valid registrations.",
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Extract all vehicles regarding of status. Return only valid JSON array.",
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: base64Image,
                            },
                        },
                    ],
                },
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "reminders",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: {
                            reminders: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        type: { type: "string", enum: ["MOT", "Service", "Cambelt", "Other"] },
                                        dueDate: { type: "string" },
                                        registration: { type: "string" },
                                        customerName: { type: "string" },
                                        customerEmail: { type: "string" },
                                        customerPhone: { type: "string" },
                                        vehicleMake: { type: "string" },
                                        vehicleModel: { type: "string" },
                                    },
                                    required: ["registration"],
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

        console.log(JSON.stringify(response.choices[0].message.content, null, 2));

    } catch (error) {
        console.error('Error:', error);
    }
}

run();
