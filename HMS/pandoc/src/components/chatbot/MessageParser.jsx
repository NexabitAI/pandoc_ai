class MessageParser {
  constructor(actionProvider) {
    this.actionProvider = actionProvider;
  }

  parse(message) {
    const lower = (message || '').trim().toLowerCase();

    // quick helpers
    if (["hi", "hello", "hey"].includes(lower)) return this.actionProvider.greet();
    if (["bye", "goodbye", "thanks", "thank you", "ok", "okay"].includes(lower)) return this.actionProvider.farewell();

    // numeric -> pick a doctor from the last list
    if (/^\d+$/.test(lower)) {
      const index = parseInt(lower, 10) - 1;
      return this.actionProvider.handleDoctorSelection(index);
    }

    // fallback: send to AI
    return this.actionProvider.handleUserMessage(message);
  }
}

export default MessageParser;
