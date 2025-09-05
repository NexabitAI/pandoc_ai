import express from "express";
import OpenAI from "openai";

const router = express.Router();
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
