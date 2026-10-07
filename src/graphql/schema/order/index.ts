import gql from 'graphql-tag';

/**
 * Order Schema
 * Guest-checkout merch orders and admin order management
 */
export const orderSchema = gql`
  # ============================================
  # Order Types
  # ============================================

  type MerchOrderItem {
    id: ID!
    productId: String!
    name: String!
    image: String
    variantId: String
    variantName: String
    unitPrice: Float!
    quantity: Int!
  }

  type MerchOrder {
    id: ID!
    orderNumber: String!
    userId: String
    customerName: String!
    phone: String!
    email: String
    address: String!
    notes: String
    status: String!
    paymentMethod: String!
    deliveryMethod: String!
    paymentClaimedAt: DateTime
    subtotal: Float!
    total: Float!
    currency: String!
    tenantId: String!
    items: [MerchOrderItem!]!
    payments: [Payment!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  # ============================================
  # Order Inputs
  # ============================================

  input CreateMerchOrderItemInput {
    productId: String!
    variantId: String
    variantName: String
    quantity: Int!
  }

  input CreateMerchOrderInput {
    customerName: String!
    phone: String!
    email: String
    address: String
    notes: String
    currency: String
    tenantId: String
    deliveryMethod: String
    items: [CreateMerchOrderItemInput!]!
  }

  # ============================================
  # Order Operations
  # ============================================

  extend type Query {
    getMerchOrders(status: String, tenantId: String, limit: Int, offset: Int): [MerchOrder!]!
    getMerchOrderById(id: ID!): MerchOrder
  }

  type MerchOrderExport {
    filename: String!
    mimeType: String!
    base64: String!
    count: Int!
  }

  input ExportMerchOrdersInput {
    orderIds: [ID!]
    startDate: DateTime
    endDate: DateTime
    tenantId: String
  }

  extend type Mutation {
    createMerchOrder(input: CreateMerchOrderInput!): MerchOrder!
    updateMerchOrderStatus(id: ID!, status: String!): MerchOrder!
    exportMerchOrders(input: ExportMerchOrdersInput!): MerchOrderExport!
  }
`;
