// Nicknames: cleaned up and filtered (the game is for kids and teens; there is no free chat, only this).
export const NAME_MAX = 12;
export const DEFAULT_NAME = 'שחקן';

// small list, matched on the name with spaces/punctuation removed
const BAD = ['זונה', 'שרמוטה', 'כוסעמק', 'בןזונה', 'מניאק', 'אידיוט', 'הומו', 'מזדיין', 'זיין', 'פוק', 'fuck', 'shit', 'bitch', 'cunt', 'dick', 'nazi', 'hitler', 'nigg', 'rape', 'porn', 'sex', 'fag'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };
const squash = (s) => s.toLowerCase().replace(/[013457@$]/g, (c) => LEET[c] ?? '').replace(/[\s\p{P}\p{S}_0-9]+/gu, '').replace(/[֑-ׇ]/g, '');

/** Returns a safe nickname (never empty, at most NAME_MAX characters). */
export function cleanName(input) {
  let s = String(input ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')   // control + invisible + bidi characters
    .replace(/\s+/g, ' ').trim();
  s = [...s].slice(0, NAME_MAX).join('').trim();
  if (!s) return DEFAULT_NAME;
  const q = squash(s);
  if (BAD.some((w) => q.includes(w))) return DEFAULT_NAME;
  return s;
}
