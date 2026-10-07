import gql from 'graphql-tag';

/**
 * Payment Schema
 * QPay invoice creation + payment status. No QPay credentials or raw provider
 * payloads are ever exposed here — only display-safe QR data and status.
 */
export const paymentSchema = gql`
  type Payment {
    id: ID!
    orderId: String!
    provider: String!
    status: String!
    amount: Float!
    currency: String!
    paidAmount: Float
    fee: Float
    netAmount: Float
    paymentWallet: String
    paymentType: String
    settlementStatus: String
    ebarimtCustomerNo: String
    qpayInvoiceId: String
    qpayPaymentId: String
    paidAt: DateTime
    createdAt: DateTime!
  }

  type QpayInvoiceDeeplink {
    name: String!
    description: String!
    logo: String!
    link: String!
  }

  type QpayInvoice {
    orderId: ID!
    invoiceId: String!
    qrText: String!
    qrImage: String!
    shortUrl: String
    deeplinks: [QpayInvoiceDeeplink!]!
    amount: Float!
    currency: String!
    status: String!
  }

  type PaymentStatusResult {
    orderId: ID!
    status: String!
    paidAt: DateTime
  }

  extend type Mutation {
    createQpayInvoice(orderId: ID!): QpayInvoice!
  }

  extend type Query {
    merchOrderPaymentStatus(orderId: ID!): PaymentStatusResult!
  }
`;
