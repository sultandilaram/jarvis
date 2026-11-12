import { createSign, createPrivateKey } from "node:crypto";
export type PushConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  client: {
    projectId: string;
    senderId: string;
    apiKey: string;
    appId: string;
  };
};
export function parsePushConfig(android: any, account: any): PushConfig {
  const projectId = android.project_info?.project_id;
  const app = android.client?.find(
    (c: any) =>
      c.client_info?.android_client_info?.package_name ===
      "com.sultan.jarvis.mobile",
  );
  if (
    !app ||
    !/^[-a-z0-9]{6,63}$/.test(projectId) ||
    account.project_id !== projectId ||
    account.type !== "service_account" ||
    typeof account.client_email !== "string" ||
    !account.client_email.endsWith(".iam.gserviceaccount.com")
  )
    throw Error(
      "Choose matching Android and service-account JSON files for com.sultan.jarvis.mobile.",
    );
  createPrivateKey(account.private_key);
  const client = {
    projectId,
    senderId: String(android.project_info.project_number),
    apiKey: app.api_key?.[0]?.current_key,
    appId: app.client_info.mobilesdk_app_id,
  };
  if (!client.apiKey || !client.appId || !/^\d+$/.test(client.senderId))
    throw Error("Android Firebase configuration is incomplete.");
  return {
    projectId,
    clientEmail: account.client_email,
    privateKey: account.private_key,
    client,
  };
}
export class PhonePush {
  config?: PushConfig;
  access?: { value: string; expires: number };
  constructor(public transport: typeof fetch = fetch) {}
  async token() {
    if (!this.config)
      throw Error(
        "Configure Firebase on the Mac before enabling background alerts.",
      );
    if (this.access && this.access.expires > Date.now() + 60000)
      return this.access.value;
    const now = Math.floor(Date.now() / 1000);
    const encode = (x: unknown) =>
      Buffer.from(JSON.stringify(x)).toString("base64url");
    const body =
      encode({ alg: "RS256", typ: "JWT" }) +
      "." +
      encode({
        iss: this.config.clientEmail,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      });
    const signer = createSign("RSA-SHA256");
    signer.update(body);
    const assertion =
      body + "." + signer.sign(this.config.privateKey).toString("base64url");
    const response = await this.transport(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const result = (await response.json()) as any;
    if (!response.ok || !result.access_token)
      throw Error(
        "Firebase authorization failed. Check the service account and FCM permission.",
      );
    this.access = {
      value: result.access_token,
      expires: Date.now() + Number(result.expires_in || 3600) * 1000,
    };
    return this.access.value;
  }
  async send(
    deviceToken: string,
    callId: string,
    deviceId = "",
    expiresAt = Date.now() + 120000,
    action = "ring",
  ) {
    const token = await this.token();
    const response = await this.transport(
      `https://fcm.googleapis.com/v1/projects/${this.config!.projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            data: { callId, deviceId, expiresAt: String(expiresAt), action },
            android: { priority: "high", ttl: "120s" },
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw Error(
        `Firebase did not accept the notification (${response.status}).`,
      );
    return {
      accepted: true,
      note: "FCM acceptance does not prove delivery to a locked phone.",
    };
  }
}
