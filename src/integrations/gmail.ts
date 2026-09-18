import { google, gmail_v1 } from "googleapis";
// Constructed via googleapis' own re-exported google-auth-library (google.auth.OAuth2)
// rather than importing the standalone `google-auth-library` package directly —
// googleapis bundles its own copy, and the two packages' OAuth2Client classes
// are structurally identical but nominally distinct types, which TypeScript
// then (correctly) refuses to treat as interchangeable.
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export type GmailAccountIndex = 0 | 1 | 2;

export type SendEmailInput = {
  accountIndex: GmailAccountIndex;
  to: string;
  subject: string;
  body: string;
  /** Set all three (Phase 6) to send in-thread as a reply, with proper headers — never set for a first-touch cold email. */
  inReplyTo?: string;
  references?: string;
  threadId?: string;
};
export type SendEmailResult = { messageId: string; fromAddress: string; threadId: string | null };

/** Real outbound send, gated behind an interface so nothing in this repo's tests ever calls Google. */
export interface GmailSender {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

export type UnreadMessageRef = { id: string; threadId: string };

/** Real inbound read, gated behind an interface for the same reason as GmailSender. */
export interface GmailReader {
  listUnread(accountIndex: GmailAccountIndex): Promise<UnreadMessageRef[]>;
  getMessage(accountIndex: GmailAccountIndex, messageId: string): Promise<gmail_v1.Schema$Message>;
  /** Removes the UNREAD label so the same message isn't reprocessed on the next poll — called once handling is decided, whatever the outcome. */
  markRead(accountIndex: GmailAccountIndex, messageId: string): Promise<void>;
}

/**
 * Same 3-rotating-account env var shape as hartwich-os's own
 * src/lib/integrations/gmail-multi.ts (GMAIL_CLIENT_ID/SECRET shared,
 * per-account GMAIL_ACCESS_TOKEN_N/GMAIL_REFRESH_TOKEN_N/GMAIL_FROM_ADDRESS_N)
 * — reimplemented here because this is a separate repo/service with no
 * code-level access to hartwich-os's integration module, only to the same
 * Gmail accounts via the same Google Cloud OAuth client (Gavin, 2026-09-09).
 * The OAuth2 client auto-refreshes the access token from the refresh
 * token, same as hartwich-os relies on.
 */
export class GoogleGmailSender implements GmailSender {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const { client, fromAddress } = buildOAuthClient(input.accountIndex);
    const gmail = google.gmail({ version: "v1", auth: client });

    const raw = buildRawMessage({
      from: fromAddress,
      to: input.to,
      subject: input.subject,
      body: input.body,
      inReplyTo: input.inReplyTo,
      references: input.references,
    });
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId: input.threadId },
    });

    return { messageId: res.data.id ?? "", fromAddress, threadId: res.data.threadId ?? null };
  }
}

export class GoogleGmailReader implements GmailReader {
  async listUnread(accountIndex: GmailAccountIndex): Promise<UnreadMessageRef[]> {
    const { client } = buildOAuthClient(accountIndex);
    const gmail = google.gmail({ version: "v1", auth: client });
    const res = await gmail.users.messages.list({ userId: "me", q: "is:unread", maxResults: 20 });
    return (res.data.messages ?? []).map((m) => ({ id: m.id ?? "", threadId: m.threadId ?? "" }));
  }

  async getMessage(accountIndex: GmailAccountIndex, messageId: string): Promise<gmail_v1.Schema$Message> {
    const { client } = buildOAuthClient(accountIndex);
    const gmail = google.gmail({ version: "v1", auth: client });
    const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    return res.data;
  }

  async markRead(accountIndex: GmailAccountIndex, messageId: string): Promise<void> {
    const { client } = buildOAuthClient(accountIndex);
    const gmail = google.gmail({ version: "v1", auth: client });
    await gmail.users.messages.modify({ userId: "me", id: messageId, requestBody: { removeLabelIds: ["UNREAD"] } });
  }
}

function buildOAuthClient(accountIndex: GmailAccountIndex): { client: OAuth2Client; fromAddress: string } {
  const n = accountIndex + 1;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const accessToken = process.env[`GMAIL_ACCESS_TOKEN_${n}`];
  const refreshToken = process.env[`GMAIL_REFRESH_TOKEN_${n}`];
  const fromAddress = process.env[`GMAIL_FROM_ADDRESS_${n}`];

  if (!clientId || !clientSecret || !accessToken || !refreshToken || !fromAddress) {
    throw new Error(`Gmail account ${accountIndex} is not fully configured — see .env.example.`);
  }

  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  return { client, fromAddress };
}

function buildRawMessage(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const headers = [`From: ${opts.from}`, `To: ${opts.to}`, `Subject: ${opts.subject}`];
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);
  headers.push("Content-Type: text/plain; charset=utf-8");

  const raw = [...headers, "", opts.body].join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

// --- Inbound message parsing (pure — no I/O, easy to unit test) ---------

export function extractHeader(message: gmail_v1.Schema$Message, name: string): string | null {
  const headers = message.payload?.headers ?? [];
  const found = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

export function extractFromAddress(message: gmail_v1.Schema$Message): string {
  const raw = extractHeader(message, "From") ?? "";
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

/** Walks the MIME tree for the first text/plain part — good enough for a reply's actual words, ignores HTML alternates/attachments. */
export function extractPlainTextBody(message: gmail_v1.Schema$Message): string | null {
  function decode(data: string): string {
    return Buffer.from(data, "base64url").toString("utf-8");
  }
  function walk(part: gmail_v1.Schema$MessagePart): string | null {
    if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
    for (const child of part.parts ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  }
  return message.payload ? walk(message.payload) : null;
}
