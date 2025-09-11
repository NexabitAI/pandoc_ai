class MessageParser {
  constructor(actionProvider) {
    this.actionProvider = actionProvider;
  }

  parse(message) {
    const text = (message || '').trim();
    const lower = text.toLowerCase();

    // 1) Greetings vs small-talk
    // - "hi/hello/hey" => greet()
    // - "how are you" => smallTalk()
    if (["hi", "hello", "hey"].includes(lower)) {
      return this.actionProvider.greet();
    }
    if (/\bhow (are|r) (you|u)\b|\bhow's it going\b/.test(lower)) {
      return this.actionProvider.smallTalk();
    }

    // Quick goodbyes/thanks
    if (["bye", "goodbye", "thanks", "thank you", "ok", "okay"].includes(lower)) {
      return this.actionProvider.farewell();
    }

    // 2) Number => select a doctor from the last list
    if (/^\d+$/.test(lower)) {
      const index = parseInt(lower, 10) - 1;
      return this.actionProvider.handleDoctorSelection(index);
    }

    // 3) User says they're done → offer doctors (unchanged)
    if (/\b(that'?s all|nothing more|no other|nothing else|just|only)\b/.test(lower)) {
      return this.actionProvider.suggestDoctorsFromContext();
    }

    // 4) User accepts the offer
    if (this.actionProvider.offerPending && /\b(yes|yeah|yep|ok|okay|please|show|doctor|doctors)\b/.test(lower)) {
      return this.actionProvider.handleUserMessage("Please show me relevant doctors.");
    }

    // 5) Comparison questions on the *current* list (no re-asking)
    if (/\bwho has more experience\b|\bmost experienced\b/.test(lower)) {
      return this.actionProvider.handleComparisonQuery('experience');
    }
    if (/\bcheapest\b|\blow(est)?\s*fee\b|\bbudget\b/.test(lower)) {
      return this.actionProvider.handleComparisonQuery('cheapest');
    }
    if (/\bmost (expensive|costly)\b|\bhighest fee\b/.test(lower)) {
      return this.actionProvider.handleComparisonQuery('expensive');
    }

    // Default: forward to backend AI
    return this.actionProvider.handleUserMessage(text);
  }
}

export default MessageParser;
