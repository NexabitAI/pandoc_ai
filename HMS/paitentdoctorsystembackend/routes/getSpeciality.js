import express from "express";
import OpenAI from "openai";

const router = express.Router();
// const openai = new OpenAI({ apiKey: "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" });
const openai = new OpenAI({ apiKey: "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" });

router.post("/", async (req, res) => {
    const { symptom } = req.body;

    if (!symptom) return res.status(400).json({ error: "Symptom is required" });

    const prompt = `Patient symptom: "${symptom}". Return only the doctor specialty that can handle this (e.g., "Cardiology", "Dermatologist", etc).`;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "user", content: prompt }],
        });

        const reply = completion.choices[0].message.content.trim();

        return res.status(200).json({ speciality: reply });
    } catch (error) {
        console.error("OpenAI error:", error.message);
        return res.status(500).json({ error: "OpenAI request failed" });
    }
});

export default router;
