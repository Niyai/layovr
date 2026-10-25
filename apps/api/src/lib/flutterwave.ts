import { HttpError } from "./errors";

/**
 * Flutterwave Standard (hosted checkout), v3 API.
 * Docs: https://developer.flutterwave.com/docs/collecting-payments/standard
 */

export type VerifiedTransaction = {
  successful: boolean;
  status: string;
  txRef: string;
  amountKobo: number;
  currency: string;
  transactionId: string;
  raw: unknown;
};

export type PaymentGateway = {
  createPayment(input: {
    txRef: string;
    amountKobo: number;
    redirectUrl: string;
    name: string;
    phone: string;
    email?: string | undefined;
    orderCode: string;
  }): Promise<{ link: string }>;
  verify(transactionId: string): Promise<VerifiedTransaction>;
};

const BASE = "https://api.flutterwave.com/v3";

export function flutterwave(secretKey: string): PaymentGateway {
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  };
  return {
    async createPayment(input) {
      const res = await fetch(`${BASE}/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          tx_ref: input.txRef,
          amount: input.amountKobo / 100,
          currency: "NGN",
          redirect_url: input.redirectUrl,
          customer: {
            // Flutterwave requires an email; many buyers only give a phone number.
            email:
              input.email ??
              `${input.phone.replace(/\D/g, "")}@buyers.layovr.app`,
            phonenumber: input.phone,
            name: input.name,
          },
          customizations: {
            title: "Layovr",
            description: `Order ${input.orderCode}`,
          },
          meta: { order_code: input.orderCode },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        status?: string;
        message?: string;
        data?: { link?: string };
      };
      if (!res.ok || json.status !== "success" || !json.data?.link) {
        console.error("[flw] create payment failed", res.status, json.message);
        throw new HttpError(502, "Couldn't start payment. Please try again.");
      }
      return { link: json.data.link };
    },

    async verify(transactionId) {
      const res = await fetch(
        `${BASE}/transactions/${encodeURIComponent(transactionId)}/verify`,
        { headers },
      );
      const json = (await res.json().catch(() => ({}))) as {
        status?: string;
        data?: {
          status?: string;
          tx_ref?: string;
          amount?: number;
          currency?: string;
          id?: number;
        };
      };
      const t = json.data ?? {};
      return {
        successful: json.status === "success" && t.status === "successful",
        status: t.status ?? "unknown",
        txRef: t.tx_ref ?? "",
        amountKobo: Math.round((t.amount ?? 0) * 100),
        currency: t.currency ?? "",
        transactionId: String(t.id ?? transactionId),
        raw: json.data ?? json,
      };
    },
  };
}
