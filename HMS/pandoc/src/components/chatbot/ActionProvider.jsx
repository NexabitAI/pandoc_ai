const BACKEND_URL = "https://mypandoc.com"; // same as before

class ActionProvider {
  constructor(createChatBotMessage, setStateFunc, state) {
    this.createChatBotMessage = createChatBotMessage;
    this.setState = setStateFunc;
    this.state = state;

    // minimal in-memory cache
    this.history = [
      { role: 'assistant', content: 'Hello! How can I assist you with your health today?' }
    ];

    // doctors returned by server (kept for selection)
    this.doctors = [];
    this.selectedDoctor = null;
  }

  updateChatbotState(message) {
    this.setState(prev => ({ ...prev, messages: [...prev.messages, message] }));
  }

  _push(role, content) {
    // keep a short rolling window to stay lean
    this.history.push({ role, content });
    if (this.history.length > 20) this.history = this.history.slice(-20);
  }

  greet() {
    const msg = this.createChatBotMessage("👋 Hi! Tell me what's going on, and I’ll help you figure which kind of doctor to see.");
    this.updateChatbotState(msg);
    this._push('assistant', msg.message);
  }

  farewell() {
    const msg = this.createChatBotMessage("👋 Take care! If anything changes, I’m here.");
    this.updateChatbotState(msg);
    this._push('assistant', msg.message);
  }

  // core: send to backend AI
  async handleUserMessage(text) {
    // user turn
    this._push('user', text);

    // loading bubble
    const thinking = this.createChatBotMessage("…");
    this.updateChatbotState(thinking);

    try {
      const res = await fetch(`${BACKEND_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: this.history })
      });
      const json = await res.json();

      // remove "…" loader by appending real message after it
      const reply = json?.reply || "Sorry, I couldn’t process that.";
      const intent = json?.intent || 'chat';
      const doctors = Array.isArray(json?.doctors) ? json.doctors : [];

      // assistant message
      const botMsg = this.createChatBotMessage(reply);
      this.updateChatbotState(botMsg);
      this._push('assistant', reply);

      // If intent=show_doctors and server returned profiles, render them
      if (intent === 'show_doctors' && doctors.length) {
        this.doctors = doctors;
        localStorage.setItem('doctors', JSON.stringify(doctors));
        this.setState(prev => ({ ...prev, doctors, selectedDoctor: null }));

        const listMsg = this.createChatBotMessage(
          "Here are some relevant doctors you can review:",
          { widget: 'doctorList', payload: doctors }
        );
        this.updateChatbotState(listMsg);
      }
    } catch (e) {
      console.error('[chat] error', e);
      const err = this.createChatBotMessage("I’m having trouble reaching our assistant right now. Please try again.");
      this.updateChatbotState(err);
      this._push('assistant', err.message);
    }
  }

  // keep these helpers for number selection + doctor info (optional)
  handleDoctorSelection = (index) => {
    const doc = this.doctors?.[index];
    if (!doc) {
      const err = this.createChatBotMessage("❌ That number doesn’t match a listed doctor.");
      return this.updateChatbotState(err);
    }
    this.selectedDoctor = doc;
    this.setState(prev => ({ ...prev, selectedDoctor: doc }));
    const msg = this.createChatBotMessage(
      `You selected Dr. ${doc.name}. You can open their profile to review details and book from there.`
    );
    this.updateChatbotState(msg);
  };

  handleDoctorFieldQuery = (msg) => {
    const d = this.selectedDoctor;
    if (!d) {
      return this.updateChatbotState(this.createChatBotMessage("Please select a listed doctor first (send their number)."));
    }
    let reply = "What would you like to know about this doctor?";
    const lower = msg.toLowerCase();
    if (lower.includes('degree'))       reply = `🎓 ${d.degree}`;
    else if (lower.includes('experience')) reply = `📅 ${d.experience}`;
    else if (lower.includes('speciality')) reply = `🧠 ${d.speciality}`;
    else if (lower.includes('address') || lower.includes('location')) reply = `🏥 ${d.address?.line1}, ${d.address?.line2}`;
    this.updateChatbotState(this.createChatBotMessage(reply));
  };
}

export default ActionProvider;
