class MessageParser {
    constructor(actionProvider) {
        this.actionProvider = actionProvider;
    }

    parse(message) {
        const lower = message.trim().toLowerCase();

        if (["hi", "hello", "hey"].includes(lower)) {
            return this.actionProvider.greet();
        }

        if (["bye", "goodbye", "thanks", "thank you", "okay", "ok"].includes(lower)) {
            return this.actionProvider.farewell();
        }

        if (/^\d+$/.test(lower)) {
            const index = parseInt(lower) - 1;
            return this.actionProvider.handleDoctorSelection(index);
        }

        if (/\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/.test(lower) && /(am|pm)/i.test(lower)) {
            return this.actionProvider.handleBooking(lower);
        }

        // ✅ Detect any kind of info request
        if (
            lower.includes("experience") ||
            lower.includes("degree") ||
            lower.includes("speciality") ||
            lower.includes("address") ||
            lower.includes("about her") ||
            lower.includes("about him")
        ) {
            return this.actionProvider.handleDoctorFieldQuery(lower);
        }

        // ✅ Specific name-based info request
        if (lower.includes("about dr.") || lower.includes("tell me about")) {
            const name = lower.split("about dr.")[1]?.trim() || lower.split("tell me about")[1]?.trim();
            return this.actionProvider.handleDoctorInfo(name);
        }

        // Otherwise treat as symptom
        return this.actionProvider.handleSymptom(lower);
    }



}

export default MessageParser;
