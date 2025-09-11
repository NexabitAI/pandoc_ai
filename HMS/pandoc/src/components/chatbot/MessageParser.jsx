class MessageParser {
  constructor(actionProvider) {
    this.actionProvider = actionProvider;
  }

  parse(message) {
    const text = (message || '').trim();
    const lower = text.toLowerCase();

    // greetings / small-talk
    if (["hi", "hello", "hey"].includes(lower) || /\bhow are you\b|\bhow r u\b|\bhow's it going\b/.test(lower)) {
      return this.actionProvider.smallTalk();
    }

    // quick goodbyes/thanks
    if (["bye", "goodbye", "thanks", "thank you", "ok", "okay"].includes(lower)) {
      return this.actionProvider.farewell();
    }

    // user selects a doctor by number
    if (/^\d+$/.test(lower)) {
      const index = parseInt(lower, 10) - 1;
      return this.actionProvider.handleDoctorSelection(index);
    }

    // user says they’re done / nothing more: offer to show doctors
    if (/\b(that'?s all|nothing more|no other|nothing else|just|only)\b/.test(lower)) {
      return this.actionProvider.suggestDoctorsFromContext();
    }

    // user says yes/show after we offered
    if (this.actionProvider.offerPending && /\b(yes|yeah|yep|ok|okay|please|show|doctor|doctors)\b/.test(lower)) {
      // nudge server to show by phrasing explicit intent
      return this.actionProvider.handleUserMessage("Please show me relevant doctors.");
    }

    // default: forward to backend AI
    return this.actionProvider.handleUserMessage(text);
  }
}

export default MessageParser;
