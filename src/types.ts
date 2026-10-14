/** Where the money came from. Per-card / per-account spend is reported against this. */
export type PaymentMethodKind = 'credit_card' | 'debit_card' | 'bank_account' | 'wallet' | 'cash';

export interface PaymentMethod {
  id: string;
  name: string;
  kind: PaymentMethodKind;
  bank?: string;
  /** Last 4 digits of the card / account; used later to match bank SMS & emails. */
  last4?: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  /** Monthly budget in paise; undefined means no budget. */
  budget?: number;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** How the payment was made (independent of which card/account funded it). */
export type Channel = 'upi' | 'card' | 'netbanking' | 'cash' | 'other';

/** debit = money spent, credit = refund / cashback that reduces spend. */
export type TxnType = 'debit' | 'credit';

/** How the entry was captured. Only 'manual' exists today; the rest are for later automation. */
export type TxnSource = 'manual' | 'sms' | 'email' | 'bot';

export interface Transaction {
  id: string;
  /** Amount in paise (integer) to avoid floating-point errors. Always positive. */
  amount: number;
  type: TxnType;
  /** Local date-time, 'YYYY-MM-DDTHH:mm'. Sortable and month-prefix searchable. */
  occurredAt: string;
  merchant: string;
  paymentMethodId: string;
  categoryId: string;
  channel?: Channel;
  notes?: string;
  source: TxnSource;
  /** Raw SMS / email / message id the entry was parsed from (automation). */
  sourceRef?: string;
  createdAt: string;
  updatedAt: string;
  /** Soft delete, so deletions can sync across devices later. */
  deletedAt?: string;
}

export const KIND_LABELS: Record<PaymentMethodKind, string> = {
  credit_card: 'Credit card',
  debit_card: 'Debit card',
  bank_account: 'Bank account',
  wallet: 'Wallet',
  cash: 'Cash',
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  cash: 'Cash',
  other: 'Other',
};
