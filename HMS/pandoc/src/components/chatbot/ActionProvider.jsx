const BACKEND_URL = "https://mypandoc.com"; // your base

class ActionProvider {
  constructor(createChatBotMessage, setStateFunc, state) {
    this.createChatBotMessage = createChatBotMessage;
    this.setState = setStateFunc;
    this.state = state;

    this.history = [
      { role: 'assistant', content: 'Hello! How can I assist you with your health today?' }
    ];

    this.doctors = [];
    this.selectedDoctor = null;
    this.offerPending = false;
  }

  updateChatbotState(message) {
    this.setState(prev => ({ ...prev, messages: [...prev.messages, message] }));
  }

  _push(role, content) {
    this.history.push({ role, content });
    if (this.history.length > 20) this.history = this.history.slice(-20);
  }

  smallTalk() {
    const msg = this.createChatBotMessage("I’m doing well and here to help with your health. What’s going on?");
    this.updateChatbotState(msg);
    this._push('assistant', msg.message);
  }

  // CHANGED: no doctor mention here
  greet() {
    const msg = this.createChatBotMessage("Hi — how can I help today? Tell me what happened.");
    this.updateChatbotState(msg);
    this._push('assistant', msg.message);
  }

  farewell() {
    const msg = this.createChatBotMessage("Take care. I’m here if you need anything else.");
    this.updateChatbotState(msg);
    this._push('assistant', msg.message);
  }

  suggestDoctorsFromContext() {
    this.offerPending = true;
    const msg = this.createChatBotMessage("Got it. Would you like me to show relevant doctors now?");
    this.updateChatbotState(msg);
    this._push('assistant', msg.message);
  }

  _years(s = '') {
    const n = parseInt(String(s).match(/\d+/)?.[0] || '0', 10);
    return Number.isNaN(n) ? 0 : n;
  }

  // comparison across the currently listed doctors
  handleComparisonQuery(kind = 'experience') {
    const list = this.doctors || [];
    if (list.length < 2) {
      const msg = this.createChatBotMessage("I need at least two doctors from the list to compare.");
      this.updateChatbotState(msg);
      this._push('assistant', msg.message);
      return;
    }

    let best = null;
    if (kind === 'experience') {
      best = [...list].sort((a, b) => this._years(b.experience) - this._years(a.experience))[0];
      const m = this.createChatBotMessage(`Most experienced: Dr. ${best.name} (${best.experience}).`);
      this.updateChatbotState(m); this._push('assistant', m.message); return;
    }
    if (kind === 'cheapest') {
      best = [...list].sort((a, b) => a.fees - b.fees)[0];
      const m = this.createChatBotMessage(`Cheapest: Dr. ${best.name} ($${best.fees}).`);
      this.updateChatbotState(m); this._push('assistant', m.message); return;
    }
    if (kind === 'expensive') {
      best = [...list].sort((a, b) => b.fees - a.fees)[0];
      const m = this.createChatBotMessage(`Most expensive: Dr. ${best.name} ($${best.fees}).`);
      this.updateChatbotState(m); this._push('assistant', m.message); return;
    }
  }

  async handleUserMessage(text) {
    this._push('user', text);

    try {
      const res = await fetch(`${BACKEND_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: this.history })
      });
      const json = await res.json();

      const reply = json?.reply || "Sorry, I couldn’t process that.";
      const intent = json?.intent || 'chat';
      const doctors = Array.isArray(json?.doctors) ? json.doctors : [];

      const botMsg = this.createChatBotMessage(reply);
      this.updateChatbotState(botMsg);
      this._push('assistant', reply);

      this.offerPending = /show (relevant|suitable) doctors/i.test(reply);

      if (intent === 'show_doctors' && doctors.length) {
        this.doctors = doctors;
        localStorage.setItem('doctors', JSON.stringify(doctors));
        this.setState(prev => ({ ...prev, doctors, selectedDoctor: null }));

        const listMsg = this.createChatBotMessage(
          "Here are relevant profiles you can review:",
          { widget: 'doctorList', payload: doctors }
        );
        this.updateChatbotState(listMsg);
        this.offerPending = false;
      }
    } catch (e) {
      console.error('[chat] error', e);
      const err = this.createChatBotMessage("I’m having trouble reaching the assistant. Please try again.");
      this.updateChatbotState(err);
      this._push('assistant', err.message);
    }
  }

  handleDoctorSelection = (index) => {
    const doc = this.doctors?.[index];
    if (!doc) {
      const err = this.createChatBotMessage("That number doesn’t match a listed doctor.");
      return this.updateChatbotState(err);
    }
    this.selectedDoctor = doc;
    this.setState(prev => ({ ...prev, selectedDoctor: doc }));
    const msg = this.createChatBotMessage(`You selected Dr. ${doc.name}. Open their profile to view details and book.`);
    this.updateChatbotState(msg);
  };

  handleDoctorFieldQuery = (msg) => {
    const d = this.selectedDoctor;
    if (!d) return this.updateChatbotState(this.createChatBotMessage("Select a listed doctor first (send their number)."));
    const lower = msg.toLowerCase();
    let reply = "What would you like to know?";
    if (lower.includes('degree')) reply = `🎓 ${d.degree}`;
    else if (lower.includes('experience')) reply = `📅 ${d.experience}`;
    else if (lower.includes('speciality')) reply = `🧠 ${d.speciality}`;
    else if (lower.includes('address') || lower.includes('location')) reply = `🏥 ${d.address?.line1}, ${d.address?.line2}`;
    this.updateChatbotState(this.createChatBotMessage(reply));
  };
}

export default ActionProvider;
