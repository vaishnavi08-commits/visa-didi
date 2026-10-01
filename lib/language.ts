// Which language to answer in: the language the person asked in.
// "hi" = Hindi in Devanagari, "hinglish" = Hindi typed in Roman script, "en" = English.
export type Lang = "en" | "hi" | "hinglish";

const DEVANAGARI = /[ऀ-ॿ]/;

// Words that are common in Hinglish and rare in English. One strong word, or two weak ones, is enough.
const HINGLISH_STRONG = /\b(kya|kyaa|mujhe|mujhko|hume|humein|chahiye|chaiye|kitna|kitne|kitni|kaise|kaisa|kahan|kab|lagega|lagegi|lagta|lagti|batao|bataiye|bataye|bata do|ghoomne|ghumne|jaana|jaana hai|jana hai|ja raha|ja rahi|ja rahe|milega|milegi|mil jayega|karna|karni|karne|padega|padegi|hoga|hogi|nahi|nahin|zaroori|zaruri|kagaz|kaagaz|kagzaat|kaagzaat|paise|wala|wali|liye|chalega|chalegi)\b/i;
const HINGLISH_WEAK = /\b(hai|hain|ke|ki|ka|ko|se|mein|me|bhi|aur|toh|ya|din|abhi)\b/gi;

export function detectLang(text: string): Lang {
  if (DEVANAGARI.test(text)) return "hi";
  if (HINGLISH_STRONG.test(text)) return "hinglish";
  const weak = new Set((text.match(HINGLISH_WEAK) ?? []).map((w) => w.toLowerCase()));
  return weak.size >= 3 ? "hinglish" : "en";
}

// How Claude should write, per language.
export function writingInstruction(lang: Lang) {
  if (lang === "hi")
    return "Write the answer in simple, everyday Hindi (Devanagari script), the way a friendly elder sister would speak. Keep visa names, form names, amounts, dates, currencies and website names exactly as the sources give them (e.g. e-Visa, DS-160, £135, 90 days can be written as 90 दिन).";
  if (lang === "hinglish")
    return "Write the answer in Hinglish: Hindi written in Roman (English) letters, mixed naturally with English words, the way Indians text each other (e.g. \"Haan, aapko e-visa lena hoga.\"). Keep visa names, form names, amounts, dates and website names exactly as the sources give them.";
  return "Write the answer in plain English.";
}

// Hindi / Hinglish topic words mapped to English, so keyword search over English official pages still works.
const TOPIC_TERMS: [RegExp, string][] = [
  [/वीज़ा चाहिए|वीजा चाहिए|वीज़ा की ज़रूरत|वीजा की जरूरत|वीज़ा लगेगा|वीजा लगेगा|visa chahiye|visa lagega|visa ki zaroorat|visa ki zarurat|वीज़ा-फ्री|बिना वीज़ा|bina visa|visa free/i, "visa required need exemption free"],
  [/फीस|शुल्क|खर्च|कितने पैसे|kitne paise|fees?|kharcha|kharch/i, "fee fees cost"],
  [/दस्तावेज़|दस्तावेज|कागज़|कागज|कागजात|डॉक्यूमेंट|kagaz|kaagaz|kagzaat|kaagzaat|documents?/i, "documents required"],
  [/कितने दिन|कितना समय|समय लगता|प्रोसेसिंग|kitne din|kitna time|kitna samay|time lagta|processing/i, "processing time days"],
  [/बिज़नेस|बिजनेस|मीटिंग|कॉन्फ्रेंस|सम्मेलन|क्लाइंट|business|meeting|conference|client/i, "business meeting conference"],
  [/पासपोर्ट|passport/i, "passport validity"],
  [/रुक|ठहर|रह सकते|ruk|reh sakte|rehna|stay/i, "stay days period"],
  [/ऑन अराइवल|आगमन पर|on arrival/i, "visa on arrival"],
  [/ई-वीज़ा|ई वीज़ा|ई-वीजा|ऑनलाइन|e-?visa|online/i, "evisa online apply"],
  [/टूरिस्ट|पर्यटन|घूमने|छुट्टी|ghoomne|ghumne|chhutti|tourist|holiday/i, "tourist tourism"],
  [/आवेदन|अप्लाई|apply|aavedan/i, "apply application"],
];

export function englishTopicTerms(text: string) {
  return TOPIC_TERMS.filter(([re]) => re.test(text)).map(([, en]) => en).join(" ");
}

// Fixed (non-AI) messages in each language.
export const MESSAGES = {
  greeting: {
    en: "Namaste! I'm Visa Didi 😊 Ask me anything about visas and entry rules for your trip — for example, \"Do I need a visa for Thailand?\"",
    hi: "नमस्ते! मैं आपकी Visa Didi हूँ 😊 अपनी यात्रा के वीज़ा या एंट्री नियमों के बारे में कुछ भी पूछिए — जैसे, \"क्या मुझे थाईलैंड के लिए वीज़ा चाहिए?\"",
    hinglish: "Namaste! Main aapki Visa Didi hoon 😊 Apni trip ke visa ya entry rules ke baare mein kuch bhi poochiye — jaise, \"Thailand ke liye visa chahiye kya?\"",
  },
  thanks: {
    en: "Anytime! 😊 Ask me if anything else comes up for your trip.",
    hi: "कोई बात नहीं! 😊 यात्रा के बारे में और कुछ पूछना हो तो बताइए।",
    hinglish: "Koi baat nahi! 😊 Trip ke baare mein aur kuch poochna ho toh bataiye.",
  },
  off_topic: {
    en: "I'm only good at one thing: visa and entry rules for Indian passport holders 🙂 Try asking something like \"Do I need a visa for Vietnam?\"",
    hi: "मैं बस एक ही चीज़ में माहिर हूँ: भारतीय पासपोर्ट वालों के लिए वीज़ा और एंट्री के नियम 🙂 कुछ ऐसा पूछकर देखिए: \"क्या मुझे वियतनाम के लिए वीज़ा चाहिए?\"",
    hinglish: "Main bas ek cheez mein expert hoon: Indian passport walon ke liye visa aur entry rules 🙂 Kuch aisa poochiye: \"Vietnam ke liye visa chahiye kya?\"",
  },
  ask_destination: {
    en: (list: string) => `Which country are you travelling to? I can help with ${list}.`,
    hi: (list: string) => `आप किस देश जा रहे हैं? मैं इनमें मदद कर सकती हूँ: ${list}।`,
    hinglish: (list: string) => `Aap kis country ja rahe ho? Main inmein help kar sakti hoon: ${list}.`,
  },
  uncovered: {
    en: (name: string, list: string) => `I don't cover ${name} yet, sorry! Right now I can help with ${list}.`,
    hi: (name: string, list: string) => `माफ़ कीजिए, ${name} अभी मेरी लिस्ट में नहीं है। अभी मैं इनमें मदद कर सकती हूँ: ${list}।`,
    hinglish: (name: string, list: string) => `Sorry, ${name} abhi meri list mein nahi hai. Abhi main inmein help kar sakti hoon: ${list}.`,
  },
  out_of_scope: {
    en: (what: string) => `I only cover tourist and short business visits for now, so I can't help with ${what}. Please check the destination's official embassy or immigration website for those.`,
    hi: (what: string) => `अभी मैं सिर्फ़ टूरिस्ट और छोटी बिज़नेस यात्राओं के बारे में बताती हूँ, इसलिए ${what} में मदद नहीं कर पाऊँगी। इसके लिए उस देश की आधिकारिक दूतावास या इमिग्रेशन वेबसाइट देखिए।`,
    hinglish: (what: string) => `Abhi main sirf tourist aur short business trips cover karti hoon, toh ${what} mein help nahi kar paungi. Uske liye us country ki official embassy ya immigration website dekhiye.`,
  },
  out_of_scope_what: {
    "student visas": { en: "student visas", hi: "स्टूडेंट वीज़ा", hinglish: "student visa" },
    "work visas": { en: "work visas", hi: "वर्क वीज़ा", hinglish: "work visa" },
    "residency or long-term visas": { en: "residency or long-term visas", hi: "रेज़िडेंसी या लंबे समय के वीज़ा", hinglish: "residency ya long-term visa" },
  } as Record<string, Record<Lang, string>>,
  other_passport: {
    en: "I only cover Indian passport holders for now. For other passports, please check the destination's official immigration website.",
    hi: "अभी मैं सिर्फ़ भारतीय पासपोर्ट वालों के लिए जानकारी देती हूँ। दूसरे पासपोर्ट के लिए उस देश की आधिकारिक इमिग्रेशन वेबसाइट देखिए।",
    hinglish: "Abhi main sirf Indian passport walon ke liye info deti hoon. Doosre passport ke liye us country ki official immigration website dekhiye.",
  },
  unavailable: {
    en: (name: string) => `I don't have ${name}'s official pages yet, so I can't confirm this. Please check the official site directly.`,
    hi: (name: string) => `मेरे पास अभी ${name} के आधिकारिक पेज नहीं हैं, इसलिए मैं इसकी पुष्टि नहीं कर सकती। कृपया सीधे आधिकारिक वेबसाइट देखिए।`,
    hinglish: (name: string) => `Mere paas abhi ${name} ke official pages nahi hain, toh main confirm nahi kar sakti. Please seedha official website dekhiye.`,
  },
  not_covered: {
    en: (names: string) => `I couldn't find this in the official ${names} sources I have.`,
    hi: (names: string) => `मुझे यह ${names} के मेरे आधिकारिक स्रोतों में नहीं मिला।`,
    hinglish: (names: string) => `Mujhe yeh ${names} ke mere official sources mein nahi mila.`,
  },
  limit: {
    en: "Didi needs a little break — I've hit my monthly limit. Please try again later, or check the official site meanwhile.",
    hi: "दीदी को थोड़ा आराम चाहिए — इस महीने की लिमिट पूरी हो गई है। कृपया बाद में कोशिश कीजिए, तब तक आधिकारिक वेबसाइट देख लीजिए।",
    hinglish: "Didi ko thoda break chahiye — is mahine ki limit poori ho gayi hai. Please baad mein try kijiye, tab tak official website dekh lijiye.",
  },
  official_site: {
    en: (name: string) => `${name} official site`,
    hi: (name: string) => `${name} की आधिकारिक वेबसाइट`,
    hinglish: (name: string) => `${name} ki official website`,
  },
};
