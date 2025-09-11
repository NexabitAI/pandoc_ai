class MessageParser {
  constructor(actionProvider) {
    this.actionProvider = actionProvider;
  }

  parse(message) {
    const text = (message || '').trim();
    const lower = text.toLowerCase();

    // Greetings vs small-talk
    if (["hi", "hello", "hey"].includes(lower)) {
      return this.actionProvider.greet(); // <-- only greet, no doctor mention
    }
    if (/\bhow (are|r) (you|u)\b|\bhow's it going\b/.test(lower)) {
      return this.actionProvider.smallTalk();
    }

    // quick goodbyes/thanks
    if (["bye", "goodbye", "thanks", "thank you", "ok", "okay"].includes(lower)) {
      return this.actionProvider.farewell();
    }

    // number -> select a doctor from the last shown list
    if (/^\d+$/.test(lower)) {
      const index = parseInt(lower, 10) - 1;
      return this.actionProvider.handleDoctorSelection(index);
    }

    // user says they're done -> offer doctors
    if (/\b(that'?s all|nothing more|no other|nothing else|just|only)\b/.test(lower)) {
      return this.actionProvider.suggestDoctorsFromContext();
    }

    // accept our offer (now also accept gender-only or price-only replies)
    if (
      this.actionProvider.offerPending &&
      /\b(yes|yeah|yep|ok|okay|please|show|doctor|doctors|male|female|cheaper|cheap(er)?|expensive|costly)\b/.test(lower)
    ) {
      return this.actionProvider.handleUserMessage("Please show me relevant doctors.");
    }

    // comparisons on current list (no re-asking)
    if (/\bwho has more experience\b|\bmost experienced\b/.test(lower)) {
      return this.actionProvider.handleComparisonQuery('experience');
    }
    if (/\bcheapest\b|\bcheap(er)?\b|\blow(est)?\s*fee\b|\bbudget\b/.test(lower)) {
      return this.actionProvider.handleComparisonQuery('cheapest');
    }
    if (/\bmost (expensive|costly)\b|\bmore expensive\b|\bhighest fee\b/.test(lower)) {
      return this.actionProvider.handleComparisonQuery('expensive');
    }

    // default -> backend AI
    return this.actionProvider.handleUserMessage(text);
  }
}

export default MessageParser;
