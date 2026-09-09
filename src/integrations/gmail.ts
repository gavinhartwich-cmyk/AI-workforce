import { google } from "googleapis";
// Constructed via googleapis' own re-exported google-auth-library (google.auth.OAuth2)
// rather than importing the standalone `google-auth-library` package directly —
// googleapis bundles its own copy, and the two packages' OAuth2Client classes
// are structurally identical but nominally distinct types, which TypeScript
// then (correctly) refuses to treat as interchangeable.
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export type GmailAccountIndex = 0 | 1 | 2;

export type SendEmailInput = { accountIndex: GmailAccountIndex; to: string; subject: string; body: string };
export type SendEmailResult = { messageId: string; fromAddress: string; threadId: string | null };

/** Real outbound send, gated behind an interface so nothing in this repo's tests ever calls Google. */
export interface GmailSender {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

/**
 * Same 3-rotating-account env var shape as hartwich-os's own
 * src/lib/integrations/gmail-multi.ts (GMAIL_CLIENT_ID/SECRET shared,
 * per-account GMAIL_ACCESS_TOKEN_N/GMAIL_REFRESH_TOKEN_N/GMAIL_FROM_ADDRESS_N)
 * — reimplemented here because this is a separate repo/service with no
 * code-level access to hartwich-os's integration module, only to the same
 * Gmail accounts via the same Google Cloud OAuth client (Gavin, 2026-09-09).
 * google-auth-library's OAuth2Client auto-refreshes the access token from
 * the refresh token, same as hartwich-os relies on.
 */
export class GoogleGmailSender implements GmailSender {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const { client, fromAddress } = buildOAuthClient(input.accountIndex);
    const gmail = google.gmail({ version: "v1", auth: client });

    const raw = buildRawMessage({ from: fromAddress, to: input.to, subject: input.subject, body: input.body });
    const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });

    return { messageId: res.data.id ?? "", fromAddress, threadId: res.data.threadId ?? null };
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

function buildRawMessage(opts: { from: string; to: string; subject: string; body: string }): string {
  const raw = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    opts.body,
  ].join("\r\n");
  return Buffer.from(raw).toString("base64url");
}
