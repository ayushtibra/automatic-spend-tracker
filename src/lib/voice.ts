import { registerPlugin } from '@capacitor/core';
import { isNative } from '../native/smsInbox';

/** Native Android plugin: android/app/src/main/java/app/spendtracker/SpeechPlugin.java */
const Speech = registerPlugin<{
  listen(options: { language?: string; prompt?: string }): Promise<{ text: string }>;
}>('Speech');

type WebRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: (e: { error: string }) => void;
  onend: () => void;
  start(): void;
  abort(): void;
};

const WebSpeech: (new () => WebRecognition) | undefined =
  typeof window === 'undefined' ? undefined : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);

export async function isVoiceAvailable(): Promise<boolean> {
  // Android: the recognizer check can report false while the app is still starting, so always
  // offer the mic; listenOnce() explains if the phone really has no speech recognizer.
  if (isNative) return true;
  return !!WebSpeech;
}

/** Thrown when the user backs out of the "speak now" screen — not an error worth showing. */
export class VoiceCancelled extends Error {}

/** Listen once (Indian English) and return what was said. */
export async function listenOnce(): Promise<string> {
  if (isNative) {
    try {
      return (await Speech.listen({ language: 'en-IN', prompt: 'Say the spend, e.g. "220 Zepto groceries HSBC card"' })).text;
    } catch (e) {
      if ((e as { code?: string }).code === 'CANCELLED') throw new VoiceCancelled();
      throw e;
    }
  }
  if (!WebSpeech) throw new Error('Voice input is not supported in this browser');
  return new Promise((resolve, reject) => {
    const r = new WebSpeech();
    r.lang = 'en-IN';
    r.interimResults = false;
    r.maxAlternatives = 1;
    let done = false;
    r.onresult = (e) => {
      done = true;
      resolve(e.results[0][0].transcript);
    };
    r.onerror = (e) => {
      done = true;
      if (e.error === 'no-speech' || e.error === 'aborted') reject(new VoiceCancelled());
      else if (e.error === 'not-allowed') reject(new Error('Microphone permission was denied'));
      else if (e.error === 'network') reject(new Error('Voice input needs an internet connection'));
      else reject(new Error(`Voice input failed (${e.error})`));
    };
    r.onend = () => !done && reject(new VoiceCancelled());
    r.start();
  });
}
