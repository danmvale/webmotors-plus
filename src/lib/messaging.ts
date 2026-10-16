import { browser } from 'wxt/browser';
import type { FipeQuery, FipeResult } from '../features/fipe/types';

/** Messages from content scripts to the background service worker. */
export interface MessageMap {
  /** Reserve a slot in the cross-tab Webmotors request budget. */
  'wm:acquire': { request: undefined; response: { delayMs: number } };
  /** Report a bot-protection block; opens the circuit for every tab. */
  'wm:blocked': { request: undefined; response: { openUntil: number } };
  /** User asked to retry now. */
  'wm:reset': { request: undefined; response: undefined };
  'fipe:resolve': { request: FipeQuery; response: FipeResult | null };
  /** Search responses shared across page loads and tabs (see ResponseCache). */
  'cache:get': { request: { key: string }; response: unknown };
  'cache:set': { request: { key: string; value: unknown }; response: undefined };
}

export type MessageType = keyof MessageMap;

export interface Envelope<T extends MessageType = MessageType> {
  type: T;
  payload: MessageMap[T]['request'];
}

type Reply<T extends MessageType> = { ok: true; value: MessageMap[T]['response'] } | { ok: false; error: string };

export async function sendMessage<T extends MessageType>(
  type: T,
  ...payload: MessageMap[T]['request'] extends undefined ? [] : [MessageMap[T]['request']]
): Promise<MessageMap[T]['response']> {
  const reply = (await browser.runtime.sendMessage({ type, payload: payload[0] } satisfies Envelope<T>)) as
    | Reply<T>
    | undefined;
  if (!reply) throw new Error(`No handler for ${type}`);
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

export type Handlers = {
  [T in MessageType]: (payload: MessageMap[T]['request']) => Promise<MessageMap[T]['response']>;
};

/** Registers handlers using the `sendResponse` + `return true` pattern (works on every MV3 Chrome). */
export function registerHandlers(handlers: Handlers): void {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const envelope = message as Envelope | undefined;
    if (!envelope || typeof envelope.type !== 'string' || !(envelope.type in handlers)) return false;
    const handler = handlers[envelope.type] as (payload: unknown) => Promise<unknown>;
    handler(envelope.payload).then(
      (value) => sendResponse({ ok: true, value }),
      (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  });
}
