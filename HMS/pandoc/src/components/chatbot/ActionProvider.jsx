const BACKEND_URL = "https://mypandoc.com";
const DOCTOR_API = "https://mypandoc.com/api/doctor/list";


class ActionProvider {
    constructor(createChatBotMessage, setStateFunc, state) {
        this.createChatBotMessage = createChatBotMessage;
        this.setState = setStateFunc;
        this.state = state;

        this.doctors = [];
        this.selectedDoctor = null;
    }

    updateChatbotState(message) {
        this.setState((prev) => ({
            ...prev,
            messages: [...prev.messages, message],
        }));
    }

    async handleSymptom(symptom) {
        const loading = this.createChatBotMessage("Analyzing your symptoms...");
        this.updateChatbotState(loading);

        try {
            const res = await fetch(`${BACKEND_URL}/api/get-speciality`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ symptom }),
            });

            const { speciality } = await res.json();

            const doctorRes = await fetch(DOCTOR_API);
            const { doctors } = await doctorRes.json();

            const matched = doctors.filter(
                (doc) =>
                    doc.speciality.toLowerCase().includes(speciality.toLowerCase()) &&
                    doc.available
            );

            if (matched.length === 0) {
                const msg = this.createChatBotMessage(`No available doctors found for "${speciality}".`);
                return this.updateChatbotState(msg);
            }

            // Save locally and in state
            this.doctors = matched;
            localStorage.setItem("doctors", JSON.stringify(matched));

            this.setState(prev => ({
                ...prev,
                doctors: matched,
                selectedDoctor: null
            }));

            // 🔥 Custom JSX message
            const msg = this.createChatBotMessage(
                "👨‍⚕️ Doctors for " + speciality + ":",
                {
                    widget: "doctorList",
                    payload: matched,
                }
            );
            this.updateChatbotState(msg);
        } catch (error) {
            const errMsg = this.createChatBotMessage("Something went wrong. Please try again.");
            this.updateChatbotState(errMsg);
        }
    }


    handleDoctorSelection = (index) => {
        const doc = this.doctors?.[index];

        if (!doc) {
            const err = this.createChatBotMessage("❌ Invalid doctor number.");
            return this.updateChatbotState(err);
        }

        this.selectedDoctor = doc;

        this.setState(prev => ({
            ...prev,
            selectedDoctor: doc,
        }));

        const available = Object.entries(doc.slots_booked || {})
            .map(([dateKey, booked]) => {
                const date = dateKey.replace(/_/g, "/");
                const all = ["10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM", "12:00 PM"];
                const free = all.filter((s) => !booked.includes(s));
                return free.length > 0 ? `${date}: ${free.join(", ")}` : null;
            })
            .filter(Boolean)
            .slice(0, 3);

        const msg = this.createChatBotMessage(
            `🕐 Available slots for Dr. ${doc.name}:\n\n${available.join(
                "\n"
            )}\n\nYou can also ask "experience of Dr. ${doc.name}" or "about Dr. ${doc.name}".`
        );
        this.updateChatbotState(msg);
    };

    handleBooking = (text) => {
        const doctor = this.selectedDoctor;

        if (!doctor) {
            const msg = this.createChatBotMessage("❌ Please select a doctor first.");
            return this.updateChatbotState(msg);
        }

        const [date, ...timeParts] = text.split(" ");
        const time = timeParts.join(" ");

        const msg = this.createChatBotMessage(
            `✅ Your appointment with Dr. ${doctor.name} is booked on ${date} at ${time}.`
        );
        this.updateChatbotState(msg);
    };

    handleDoctorInfo = (inputName) => {
        const cleanInput = inputName?.toLowerCase().replace(/[^a-z0-9]/gi, "");

        // ✅ Step 1: Get from memory or localStorage
        let doctors = this.doctors;

        if (!doctors || doctors.length === 0) {
            const stored = localStorage.getItem("doctors");
            doctors = stored ? JSON.parse(stored) : [];
        }

        // ✅ Step 2: Try to match doctor name
        const doctor = doctors.find((doc) =>
            doc.name.toLowerCase().replace(/[^a-z0-9]/gi, "").includes(cleanInput)
        );

        if (!doctor) {
            const msg = this.createChatBotMessage("❌ Doctor not found. Please check the name or try again.");
            return this.updateChatbotState(msg);
        }

        const info = `
👩‍⚕️ Name: ${doctor.name}
🎓 Degree: ${doctor.degree}
🧠 Speciality: ${doctor.speciality}
📅 Experience: ${doctor.experience}
🏥 Address: ${doctor.address?.line1}, ${doctor.address?.line2}
📝 About: ${doctor.about}
💰 Fee: $${doctor.fees}
🔗 [Book Appointment](${BACKEND_URL}/appointment/${doctor._id})
`.trim();

        const msg = this.createChatBotMessage(info);
        this.updateChatbotState(msg);
    };


    greet() {
        this.updateChatbotState(this.createChatBotMessage("👋 Hello! How can I help you today?"));
    }
    farewell() {
        const replies = ["👋 Take care!", "Goodbye!", "Wishing you good health!", "Bye for now!"];
        const msg = this.createChatBotMessage(replies[Math.floor(Math.random() * replies.length)]);
        this.updateChatbotState(msg);
    }


    defaultReply() {
        this.updateChatbotState(this.createChatBotMessage("❓ Please describe your symptoms."));
    }
    handleDoctorFieldQuery = (msg) => {
        const lower = msg.toLowerCase();
        const doctor = this.selectedDoctor;

        if (!doctor) {
            return this.updateChatbotState(
                this.createChatBotMessage("❗ Please select a doctor first.")
            );
        }

        let reply = "";

        if (lower.includes("degree")) {
            reply = `🎓 Dr. ${doctor.name}'s degree is: ${doctor.degree}`;
        } else if (lower.includes("experience")) {
            reply = `📅 Dr. ${doctor.name} has ${doctor.experience} of experience.`;
        } else if (lower.includes("speciality")) {
            reply = `🧠 Dr. ${doctor.name}'s speciality is: ${doctor.speciality}`;
        } else if (lower.includes("location") || lower.includes("address")) {
            reply = `🏥 Dr. ${doctor.name} is located at ${doctor.address?.line1}, ${doctor.address?.line2}`;
        } else {
            reply = `❓ Could you clarify what you'd like to know about Dr. ${doctor.name}?`;
        }

        this.updateChatbotState(this.createChatBotMessage(reply));
    };


}

export default ActionProvider;
