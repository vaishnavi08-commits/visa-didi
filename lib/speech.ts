// Text that gets spoken aloud: voices read emoji out as words ("smiling face"), so drop them.
export function speakable(text: string) {
  return text
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export const MAX_SPOKEN_CHARS = 700;
