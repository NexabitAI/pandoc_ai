class MessageParser {
  constructor(actionProvider) {
    this.actionProvider = actionProvider;
  }

  parse(message) {
    const text = (message || '').trim();
    const lower = text.toLowerCase();

    // Greetings vs small-talk
    if (["hi", "hello", "hey"].includes(lower)) {
      return this.actionProvider.greet();
    }
    if (/\bhow (are|r) (you|u)\b|\bhow's it going\b/.test(lower)) {
      return this.actionProvider.smallTalk();
    }

    // quick goodbyes/thanks
    if (["bye", "goodbye", "thanks", "thank you", "ok", "okay"].includes(lower)) {
      return this.actionProvider.farewell();
    }

    // number -> select from last shown list
    if (/^\d+$/.test(lower)) {
      const index = parseInt(lower, 10) - 1;
      return this.actionProvider.handleDoctorSelection(index);
    }

    // user says they're done -> offer doctors
    if (/\b(that'?s all|nothing more|no other|nothing else|just|only)\b/.test(lower)) {
      return this.actionProvider.suggestDoctorsFromContext();
    }

    // --- NEW: gender-only intent with last specialty memory ---
    const lastSpec = this.actionProvider.getLastSpecialty();
    const genderOnly = /\b(female|male)\b/.test(lower) && /\bdoctor\b/.test(lower) && !/\bdermat|cardio|neuro|ortho|bone|gastro|ent|eye|urolog|psychi|pediatric|gyne|obgyn|endocrin|hepat|rheumat|oncolog|pulmo|nephro|wound|sports|emergency|ophthal|spine|hand|vascular|colorectal|bariatric|plastic|radiology|icu|critical|pain|sleep|allergy|immunolog|addiction|geriatr|men('|)s|women('|)s|andrology|genetic|nutrition|phlebology|palliative|occupational|pm&r|rehab|toxicology|hyperbaric|wilderness/i.test(lower) === false;

    if (genderOnly && lastSpec) {
      const gender = lower.includes('female') ? 'female' : 'male';
      const proxy = `Please show me ${gender} ${lastSpec} doctors.`;
      return this.actionProvider.handleUserMessage(proxy);
    }

    // accept offer; if reply is just gender or generic "doctor/show", inject last specialty if available
    if (
      this.actionProvider.offerPending &&
      /\b(yes|yeah|yep|ok|okay|please|show|doctor|doctors|male|female|cheaper|cheap(er)?|expensive|costly)\b/.test(lower)
    ) {
      if ((/\bfemale\b|\bmale\b/.test(lower)) && lastSpec && !/\bdermat|cardio|neuro|ortho|bone|gastro|ent|eye|urolog|psychi|pediatric|gyne|obgyn|endocrin|hepat|rheumat|oncolog|pulmo|nephro|wound|sports|emergency|ophthal|spine|hand|vascular|colorectal|bariatric|plastic|radiology|icu|critical|pain|sleep|allergy|immunolog|addiction|geriatr|men('|)s|women('|)s|andrology|genetic|nutrition|phlebology|palliative|occupational|pm&r|rehab|toxicology|hyperbaric|wilderness/i.test(lower)) {
        const g = lower.includes('female') ? 'female' : 'male';
        return this.actionProvider.handleUserMessage(`Please show me ${g} ${lastSpec} doctors.`);
      }
      return this.actionProvider.handleUserMessage("Please show me relevant doctors.");
    }

    // comparisons on current list
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
